import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {installLatencyReporter} from "./LatencyReporter"

class Context extends EventTarget {
    state = "running"
    get outputLatency() {return 0.05}
    close() {this.state = "closed"; this.dispatchEvent(new Event("statechange"))}
}
const install = (context: Context) => installLatencyReporter(context as unknown as AudioContext)
beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal("localStorage", {getItem: vi.fn(() => null), setItem: vi.fn()}); vi.stubGlobal("navigator", {sendBeacon: vi.fn()})})
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()})

it("owns one timer per context and retires on close or owner teardown", () => {
    const owner = new Terminator()
    const first = new Context()
    const read = vi.spyOn(first, "outputLatency", "get")
    const handle = install(first)
    expect(install(first)).toBe(handle)
    owner.own(handle!)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(10_000)
    expect(read).toHaveBeenCalledTimes(1)
    first.close()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(20_000)
    expect(read).toHaveBeenCalledTimes(1)
    owner.own(install(new Context())!)
    owner.terminate()
    expect(vi.getTimerCount()).toBe(0)
    expect(install(first)).toBeDefined()
    expect(vi.getTimerCount()).toBe(0)
})

it.each(["{", "{}", "null", '"text"', "[-1]", "[501]", "[1.5]", '["5"]',
    JSON.stringify(Array(502).fill(1)), " ".repeat(4097)])(
    "isolates malformed or oversized stored latency buckets", raw => {
        vi.mocked(localStorage.getItem).mockReturnValue(raw)
        const handle = install(new Context())
        expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
        expect(navigator.sendBeacon).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
        vi.advanceTimersByTime(20_000)
        expect(localStorage.getItem).toHaveBeenCalledTimes(1)
        handle.terminate()
    })

it.each(["read", "write", "beacon"])("isolates %s refusal and retires optional reporting", failure => {
    const refuse = () => {throw new DOMException("Synthetic refusal", "SecurityError")}
    if (failure === "read") {vi.mocked(localStorage.getItem).mockImplementation(refuse)}
    if (failure === "write") {vi.mocked(localStorage.setItem).mockImplementation(refuse)}
    if (failure === "beacon") {vi.mocked(navigator.sendBeacon).mockImplementation(refuse)}
    const handle = install(new Context())
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    expect(localStorage.getItem).toHaveBeenCalledTimes(1)
    handle.terminate()
})

it("deduplicates valid numeric buckets across timer ticks and context replacements", () => {
    let stored = "[10,10]"
    vi.mocked(localStorage.getItem).mockImplementation(() => stored)
    vi.mocked(localStorage.setItem).mockImplementation((_, value) => {stored = value})
    const context = new Context()
    install(context)
    vi.advanceTimersByTime(30_000)
    expect(navigator.sendBeacon).toHaveBeenCalledExactlyOnceWith(expect.any(String), JSON.stringify({latency: 50}))
    expect(JSON.parse(stored)).toEqual([10, 50])
    context.close()
    const handle = install(new Context())
    vi.advanceTimersByTime(10_000)
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1)
    handle.terminate()
})

it.each([NaN, Infinity, -0.05, 0])("ignores unusable measured latency %s", latency => {
    const context = new Context()
    vi.spyOn(context, "outputLatency", "get").mockReturnValue(latency)
    const handle = install(context)
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
    expect(navigator.sendBeacon).not.toHaveBeenCalled()
    handle.terminate()
})


it("isolates refusal while discovering localStorage itself", () => {
    Object.defineProperty(globalThis, "localStorage", {configurable: true, get() {
        throw new DOMException("Synthetic storage discovery refusal", "SecurityError")
    }})
    const handle = install(new Context())
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow()
    expect(navigator.sendBeacon).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    handle.terminate()
})
