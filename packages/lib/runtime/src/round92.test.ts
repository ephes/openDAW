import {afterEach, describe, expect, it, vi} from "vitest"
import {RuntimeNotifier} from "@opendaw/lib-std"
import {Promises} from "./promises"
import {network} from "./network"

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()})
const flush = async () => {for (let i = 0; i < 15; i++) {await Promise.resolve()}}

describe("concurrency admission", () => {
    it.each([0, -1, 1.5, NaN, Infinity, -Infinity])("refuses %s before scheduling any providers", async limit => {
        const provider = vi.fn().mockResolvedValue("result")
        await expect(Promises.allWithLimit([provider], limit)).rejects.toBeInstanceOf(RangeError)
        await expect(Promises.allSettledWithLimit([provider], limit)).rejects.toBeInstanceOf(RangeError)
        expect(() => new Promises.Limit(limit)).toThrow(RangeError)
        expect(provider).not.toHaveBeenCalled()
    })
    it.each(["allWithLimit", "allSettledWithLimit", "Limit"] as const)("%s bounds active jobs and keeps result order", async mode => {
        let active = 0
        let peak = 0
        const releases: Array<() => void> = []
        const tasks = Array.from({length: 5}, (_, index) => async () => {
            peak = Math.max(peak, ++active)
            await new Promise<void>(resolve => releases.push(resolve))
            active--
            return index
        })
        const limiter = new Promises.Limit<number>(2)
        const result = mode === "Limit" ? Promise.all(tasks.map(task => limiter.add(task))) : Promises[mode](tasks, 2)
        await flush()
        expect(releases).toHaveLength(2)
        releases.shift()!()
        await flush()
        while (releases.length > 0) {releases.shift()!(); await flush()}
        expect(peak).toBe(2)
        const expected = [0, 1, 2, 3, 4]
        expect(await result).toEqual(mode === "allSettledWithLimit" ? expected.map(value => ({status: "fulfilled", value})) : expected)
        expect(await Promises.allWithLimit([], 99)).toEqual([])
        expect(await Promises.allSettledWithLimit([], 99)).toEqual([])
    })
})

describe("defaultFetch cancellation", () => {
    it.each([true, false])("does no fetch or prompt for an already aborted Request (online=%s)", async onLine => {
        vi.stubGlobal("navigator", {onLine})
        const fetch = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"))
        vi.stubGlobal("fetch", fetch)
        const approve = vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
        const controller = new AbortController()
        const reason = new Error("cancelled by caller")
        controller.abort(reason)
        await expect(network.defaultFetch(new Request("https://example.test", {signal: controller.signal}))).rejects.toBe(reason)
        expect(fetch).not.toHaveBeenCalled()
        expect(approve).not.toHaveBeenCalled()
    })
    it.each([true, false])("does not retry an AbortError during fetch (online=%s)", async onLine => {
        vi.useFakeTimers()
        vi.stubGlobal("navigator", {onLine})
        const reason = new DOMException("cancelled", "AbortError")
        const fetch = vi.fn().mockRejectedValue(reason)
        vi.stubGlobal("fetch", fetch)
        const approve = vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
        const result = network.defaultFetch("https://example.test")
        const assertion = expect(result).rejects.toBe(reason)
        await vi.runAllTimersAsync()
        await assertion
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(approve).not.toHaveBeenCalled()
    })
    it.each([true, false])("settles cancellation during an active fetch (online=%s)", async onLine => {
        vi.stubGlobal("navigator", {onLine})
        const controller = new AbortController()
        const reason = new Error("stop active request")
        const fetch = vi.fn((_input, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason), {once: true})
        }))
        vi.stubGlobal("fetch", fetch)
        const approve = vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
        const result = network.defaultFetch("https://example.test", {signal: controller.signal})
        const assertion = expect(result).rejects.toBe(reason)
        controller.abort(reason)
        await assertion
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(approve).not.toHaveBeenCalled()
    })
    it("aborts an online backoff and releases its timer", async () => {
        vi.useFakeTimers()
        vi.stubGlobal("navigator", {onLine: true})
        const fetch = vi.fn().mockRejectedValue(new TypeError("network failed"))
        vi.stubGlobal("fetch", fetch)
        const controller = new AbortController()
        const result = network.defaultFetch("https://example.test", {signal: controller.signal})
        void result.catch(() => {}) // Observe rejection before advancing the synthetic clock.
        await flush()
        const reason = new Error("stop during backoff")
        controller.abort(reason)
        await vi.runAllTimersAsync()
        await expect(result).rejects.toBe(reason)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })
    it("retires a pending offline approval and ignores its late acceptance", async () => {
        vi.useFakeTimers()
        vi.stubGlobal("navigator", {onLine: false})
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")))
        let accept!: (value: boolean) => void
        vi.spyOn(RuntimeNotifier, "approve").mockImplementation(() => new Promise(resolve => {accept = resolve}))
        const controller = new AbortController()
        const result = network.defaultFetch("https://example.test", {signal: controller.signal})
        const reason = new Error("stop while offline")
        const assertion = expect(result).rejects.toBe(reason)
        await flush()
        controller.abort(reason)
        accept(true)
        await vi.runAllTimersAsync()
        await assertion
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })
    it("still retries a transient error and honors init.signal over Request.signal", async () => {
        vi.useFakeTimers()
        vi.stubGlobal("navigator", {onLine: true})
        const response = new Response("ok")
        const fetch = vi.fn().mockRejectedValueOnce(new TypeError("transient")).mockResolvedValue(response)
        vi.stubGlobal("fetch", fetch)
        const aborted = AbortSignal.abort()
        const result = network.defaultFetch(new Request("https://example.test", {signal: aborted}), {signal: new AbortController().signal})
        await vi.runAllTimersAsync()
        expect(await result).toBe(response)
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe("sequential results workload", () => {
    it("runs 10k ordered providers without iterating over accumulated result arrays", async () => {
        const iterator = Array.prototype[Symbol.iterator]
        let visits = 0
        // Count spread/iteration of the numeric result prefix, rather than elapsed time.
        Array.prototype[Symbol.iterator] = function* () {
            for (let i = 0; i < this.length; i++) {
                if (typeof this[i] === "number") {visits++}
                yield this[i]
            }
            return undefined
        }
        let result: number[]
        try {result = await Promises.sequentialAll(Array.from({length: 10_000}, (_, index) => async () => index))}
        finally {Array.prototype[Symbol.iterator] = iterator}
        expect(result).toEqual(Array.from({length: 10_000}, (_, i) => i))
        expect(visits).toBeLessThanOrEqual(10_000)
    })
    it("stops at the first rejection without exposing partial results", async () => {
        const calls: number[] = []
        const reason = new Error("synthetic failure")
        await expect(Promises.sequentialAll([0, 1, 2].map(index => async () => {
            calls.push(index)
            if (index === 1) {throw reason}
            return index
        }))).rejects.toBe(reason)
        expect(calls).toEqual([0, 1])
    })
})
