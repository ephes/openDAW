import {afterEach, describe, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {Html} from "@opendaw/lib-dom"
import {HTML} from "./HTML"

const flush = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve()}}
const mount = (props: Parameters<typeof HTML>[0]) => {
    const host = document.createElement("section")
    document.body.append(host)
    host.append(HTML(props))
    return host
}
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()})

describe("HTML trust boundary", () => {
    it("sanitizes active HTML/SVG and retains documentation formatting", async () => {
        const host = mount({src: Promise.resolve(new Response(`<div onclick="alert(1)"><h2 id="help">Help</h2>
            <a href="javascript:alert(1)">bad</a><iframe srcdoc="bad"></iframe><script>alert(1)</script>
            <style>body{display:none}</style><form><input></form>
            <svg onload="alert(1)"><a href="javascript:alert(1)"><path d="M0 0L1 1"/></a></svg>
            <table><tr><td><strong>OK</strong></td></tr></table><a href="https://example.test/help">docs</a></div>`)), className: "help formatted"})
        await flush()
        expect(host.querySelector("script, iframe, style, form, input, [onclick], [onload], [srcdoc]")).toBeNull()
        expect(host.querySelector('[href^="javascript:"]')).toBeNull()
        expect(host.querySelector("svg path")).not.toBeNull()
        expect(host.querySelector("strong")?.textContent).toBe("OK")
        expect(host.querySelector("#help")?.textContent).toBe("Help")
        expect(host.querySelector("a[href='https://example.test/help']")).not.toBeNull()
        expect(host.querySelector(".help.formatted")).not.toBeNull()
    })
    it("includes the root when sanitizing an element directly", () => {
        const root = document.createElement("a")
        root.setAttribute("onclick", "alert(1)")
        root.setAttribute("href", "javascript:alert(1)")
        Html.sanitize(root)
        expect(root.hasAttribute("onclick")).toBe(false)
        expect(root.hasAttribute("href")).toBe(false)
    })
    it("mounts a literal string after the caller attaches its placeholder", async () => {
        const host = mount({src: "<p>literal</p>"})
        await flush()
        expect(host.querySelector("p")?.textContent).toBe("literal")
    })
})

describe("HTML response admission", () => {
    it.each(["status", "declared", "chunked"])("refuses %s bodies before publishing markup and cancels them", async kind => {
        const cancel = vi.fn()
        let pulls = 0
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pulls === 4) {controller.close(); return}
                pulls++; controller.enqueue(new Uint8Array(512 * 1024).fill(65))
            }, cancel
        }, {highWaterMark: 0})
        const response = new Response(stream, {status: kind === "status" ? 500 : 200,
            headers: kind === "declared" ? {"Content-Length": String(2 * 1024 * 1024)} : {}})
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        const host = mount({src: Promise.resolve(response)})
        await flush()
        expect(host.textContent).toBe("Could not load content.")
        expect(host.querySelector("div")).toBeNull()
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(pulls).toBeLessThanOrEqual(kind === "chunked" ? 3 : 0)
        expect(response.body?.locked).toBe(false)
        expect(warning).toHaveBeenCalledTimes(1)
    })
    it("uses actual UTF-8 byte length and accepts a bounded document", async () => {
        const host = mount({src: Promise.resolve(new Response("<p>Grüße</p>"))})
        await flush()
        expect(host.textContent).toBe("Grüße")
    })
    it("counts UTF-8 bytes for literal sources and refuses before parsing", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const parse = vi.spyOn(Html, "sanitizeMarkup")
        const host = mount({src: "ä".repeat(512 * 1024 + 1)})
        await flush()
        expect(host.textContent).toBe("Could not load content.")
        expect(parse).not.toHaveBeenCalled()
    })
    it("bounds pending response headers and cancels a late response body", async () => {
        vi.useFakeTimers()
        let resolve!: (value: Response) => void
        const src = new Promise<Response>(yes => {resolve = yes})
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        const parse = vi.spyOn(Html, "sanitizeMarkup")
        const host = mount({src})
        await vi.advanceTimersByTimeAsync(15_000)
        expect(host.textContent).toBe("Could not load content.")
        const cancel = vi.fn()
        resolve(new Response(new ReadableStream({cancel})))
        await flush()
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(parse).not.toHaveBeenCalled()
        expect(warning).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })
    it("stops a trickling response at the whole-attempt deadline", async () => {
        vi.useFakeTimers()
        const cancel = vi.fn()
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const response = new Response(new ReadableStream<Uint8Array>({start(value) {controller = value}, cancel}))
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const host = mount({src: Promise.resolve(response)})
        await flush()
        for (let i = 0; i < 3; i++) {
            controller.enqueue(new TextEncoder().encode("<p>"))
            await vi.advanceTimersByTimeAsync(5000)
        }
        expect(host.textContent).toBe("Could not load content.")
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(response.body?.locked).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe("HTML pending ownership", () => {
    it.each(["resolve", "reject"] as const)("fences a retired response that later %s", async outcome => {
        let resolve!: (value: Response) => void
        let reject!: (reason: unknown) => void
        const src = new Promise<Response>((yes, no) => {resolve = yes; reject = no})
        const lifecycle = new Terminator()
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        const parse = vi.spyOn(Html, "sanitizeMarkup")
        const host = mount({src, lifecycle})
        await flush()
        lifecycle.terminate()
        const cancel = vi.fn()
        const response = new Response(new ReadableStream({cancel}))
        if (outcome === "resolve") {resolve(response)} else {reject(new Error("late"))}
        await flush()
        expect(host.querySelector("div, p")).toBeNull()
        expect(host.textContent).toBe("")
        expect(warning).not.toHaveBeenCalled()
        expect(parse).not.toHaveBeenCalled()
        if (outcome === "resolve") {expect(cancel).toHaveBeenCalledTimes(1)}
        const current = mount({src: "<p>current</p>"})
        await flush()
        expect(current.textContent).toBe("current")
    })
    it("observes caller-promise rejection even when disposed before its first microtask", async () => {
        const lifecycle = new Terminator()
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        const host = mount({src: Promise.reject(new Error("early failure")), lifecycle})
        lifecycle.terminate()
        await flush()
        expect(host.textContent).toBe("")
        expect(warning).not.toHaveBeenCalled()
    })
    it("cancels and unlocks a pending body on removal", async () => {
        const cancel = vi.fn()
        const response = new Response(new ReadableStream({cancel}))
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        const host = mount({src: Promise.resolve(response)})
        await flush()
        host.remove()
        await flush()
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(response.body?.locked).toBe(false)
        expect(warning).not.toHaveBeenCalled()
    })
    it("aborts owned URL fetches when their mounted placeholder is detached", async () => {
        let signal!: AbortSignal
        vi.stubGlobal("fetch", vi.fn((_url, init) => {
            signal = init.signal
            return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
        }))
        const host = mount({src: new URL("https://example.test/help")})
        await flush()
        host.remove()
        await flush()
        expect(signal.aborted).toBe(true)
        expect(host.textContent).toBe("")
    })
})
