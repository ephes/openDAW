import {resolve} from "node:path"
import {readFileSync} from "node:fs"
import {expect, it, vi} from "vitest"

const html = readFileSync(resolve(__dirname, "../../../../app/studio/public/auth-callback.html"), "utf8")
function run(query: string, fail = false) {
    const postMessage = vi.fn(() => {if (fail) {throw new Error('<img onerror="bad()"> Ω')}})
    document.body.innerHTML = '<div id="container"></div>'
    const url = new URL(`https://studio.example/auth-callback.html${query}`)
    const callbackWindow = {location: url, close: vi.fn(), onbeforeunload: null as null | (() => void)}
    const Channel = class {postMessage = postMessage; close() {}}
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
    new Function("window", "document", "BroadcastChannel", script)(callbackWindow, document, Channel)
    return {callbackWindow, postMessage, container: document.getElementById("container")!}
}
for (const prefix of ["?", "#"]) {
    it(`renders provider markup as text in ${prefix} errors and correlates close/error`, () => {
        const value = '<img src=x onerror="bad()"> " Ω'
        const {callbackWindow, container, postMessage} = run(prefix + new URLSearchParams({state: "google.attempt", error: "denied", error_description: value}))
        expect(container.textContent).toContain(value)
        expect(container.querySelector("img,[onerror]")).toBeNull()
        expect(postMessage).toHaveBeenCalledWith({type: "auth-error", state: "google.attempt", service: "google"})
        callbackWindow.onbeforeunload?.()
        expect(postMessage).toHaveBeenLastCalledWith({type: "closed", state: "google.attempt", service: "google"})
        callbackWindow.close()
    })
}
it("renders communication exceptions as text", () => {
    const {callbackWindow, container} = run("?state=dropbox.attempt&code=synthetic", true)
    expect(container.textContent).toContain('<img onerror="bad()"> Ω')
    expect(container.querySelector("img,[onerror]")).toBeNull()
    callbackWindow.close()
})
it("forwards state/provider with tokens and refuses missing state", () => {
    const valid = run("#state=google.attempt&access_token=synthetic")
    expect(valid.postMessage).toHaveBeenCalledWith({type: "auth-callback", state: "google.attempt", service: "google", access_token: "synthetic"})
    const invalid = run("#access_token=synthetic")
    expect(invalid.postMessage).not.toHaveBeenCalled()
    valid.callbackWindow.close(); invalid.callbackWindow.close()
})
