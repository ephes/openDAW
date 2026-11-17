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
