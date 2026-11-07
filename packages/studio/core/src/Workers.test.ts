import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {Workers} from "./Workers"
let instances: FakeWorker[], throwConstructor: boolean
class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onmessageerror: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminate = vi.fn()
    constructor() {if (throwConstructor) {throw new Error("construction failed")}; instances.push(this)}
    postMessage() {}
    ready() {this.onmessage?.({data: {__id__: "42", channel: "initialize", message: "ready"}} as MessageEvent)}
}
beforeEach(() => {instances = []; throwConstructor = false; Workers.messenger = Option.None; vi.useFakeTimers(); vi.stubGlobal("Worker", FakeWorker)})
afterEach(() => {Workers.messenger.ifSome(x => x.terminate()); Workers.messenger = Option.None; vi.useRealTimers(); vi.unstubAllGlobals()})
for (const failure of ["constructor", "error", "messageerror", "timeout"]) {
    it(`settles ${failure}, releases the attempt, ignores late readiness and permits retry`, async () => {
        throwConstructor = failure === "constructor"
        let outcome = "pending"
        Workers.install("synthetic.js").then(() => {outcome = "resolved"}, () => {outcome = "rejected"})
        const first = instances[0]
        const late = first?.onmessage
        if (failure === "error") {first.onerror?.({} as ErrorEvent)}
        if (failure === "messageerror") {first.onmessageerror?.({type: "messageerror"} as MessageEvent)}
        await vi.advanceTimersByTimeAsync(10001)
        expect(outcome).toBe("rejected")
        expect(Workers.messenger.isEmpty()).toBe(true)
        if (first) {expect(first.terminate).toHaveBeenCalledTimes(1); expect(first.onmessage).toBeNull(); expect(first.onmessageerror).toBeNull(); expect(first.onerror).toBeNull()}
        throwConstructor = false
        const retry = Workers.install("valid.js")
        const second = instances.at(-1)!
        second.ready(); await retry
        const installed = Workers.messenger.unwrap()
        late?.({data: {__id__: "42", channel: "initialize", message: "ready"}} as MessageEvent)
        expect(Workers.messenger.unwrap()).toBe(installed)
        expect(second.terminate).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })
}
it("publishes only after readiness and rejects a concurrent install", async () => {
    const installing = Workers.install("valid.js")
    expect(Workers.messenger.isEmpty()).toBe(true)
    await expect(Workers.install("other.js")).rejects.toThrow(/installed|initializ/)
    instances[0].ready(); await installing
    expect(Workers.messenger.nonEmpty()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
})
