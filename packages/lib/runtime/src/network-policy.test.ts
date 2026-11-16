import {afterEach, expect, it, vi} from "vitest"
import {Errors} from "@opendaw/lib-std"
import {network} from "./network"
import {Promises} from "./promises"
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals()})
for (const [reason, eligible] of [
    [new TypeError("synthetic network"), true], [{status: 503}, true], [{status: 429}, true], [{status: 408}, true],
    [new Errors.FileNotFound("synthetic"), false], [new DOMException("cancel", "AbortError"), false],
    [{status: 401}, false], [{status: 403}, false], [{status: 404}, false], [{status: 409}, false],
    [new Error("invalid content"), false], [new RangeError("limit"), false]
] as const) {
    it(`bounds retry eligibility for ${String(reason)}`, () => {
        for (const count of [1, 2, 3, 100, 101]) {expect(network.defaultRetry(reason, count)).toBe(eligible && count < 3)}
    })
}
it("settles guarded read retries after three attempts and preserves the original failure", async () => {
    vi.useFakeTimers(); vi.stubGlobal("navigator", {onLine: true})
    const reason = new TypeError("synthetic network")
    const read = vi.fn().mockRejectedValue(reason)
    let released = false
    const result = Promises.guardedRetry(read, network.defaultRetry).finally(() => {released = true})
    const observed = expect(result).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(3000)
    // Stop the old unbounded policy without running an unbounded fake timer drain.
    if (read.mock.calls.length > 3) {read.mockResolvedValueOnce(undefined)}
    expect(read).toHaveBeenCalledTimes(3)
    await observed
    expect(released).toBe(true)
})
for (const encoding of ["identity", "gzip", "deflate", "br"]) {
    it(`bounds decoded fetch bytes for ${encoding}`, async () => {
        const response = () => new Response(new Uint8Array([1, 2]), {headers: {"Content-Encoding": encoding, "Content-Length": "1"}})
        await expect(network.readBounded(response(), 1)).rejects.toThrow(/byte limit/)
        expect(new Uint8Array(await network.readBounded(response(), 2))).toEqual(new Uint8Array([1, 2]))
    })
}
it("settles a queued download on abort without starting it and keeps permits flowing", async () => {
    const gates = Array.from({length: 4}, () => Promise.withResolvers<void>())
    const running = gates.map(gate => network.withDownload(() => gate.promise))
    const controller = new AbortController()
    const started = vi.fn()
    const queued = network.withDownload(async () => {started()}, controller.signal)
    const next = vi.fn(async () => "next")
    const later = network.withDownload(next)
    controller.abort()
    await expect(queued).rejects.toThrow(/abort/i)
    gates.forEach(gate => gate.resolve())
    await Promise.all(running)
    await expect(later).resolves.toBe("next")
    expect(started).not.toHaveBeenCalled()
    await expect(network.withDownload(async () => "never", controller.signal)).rejects.toThrow(/abort/i)
})
