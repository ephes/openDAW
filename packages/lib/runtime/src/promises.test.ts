import {afterEach, describe, expect, it, vi} from "vitest"
import {TimeSpan} from "@opendaw/lib-std"
import {IntervalRetryOption, Promises} from "./promises"

afterEach(() => vi.useRealTimers())

describe("retry ownership", () => {
    it("gives sequential and concurrent operations three attempts each", async () => {
        vi.useFakeTimers()
        const run = async () => {
            const factory = vi.fn(() => Promise.reject(new Error("offline")))
            const result = Promises.retry(factory).catch(() => "failed")
            await vi.runAllTimersAsync()
            expect(await result).toBe("failed")
            expect(factory).toHaveBeenCalledTimes(3)
        }
        await run()
        await run()
        const factories = [vi.fn(() => Promise.reject("first")), vi.fn(() => Promise.reject("second"))]
        const results = factories.map(factory => Promises.retry(factory).catch(reason => reason))
        await vi.runAllTimersAsync()
        expect(await Promise.all(results)).toEqual(["first", "second"])
        factories.forEach(factory => expect(factory).toHaveBeenCalledTimes(3))
    })
    it("never reopens an exhausted supplied policy", () => {
        vi.useFakeTimers()
        const policy = new IntervalRetryOption(3, TimeSpan.millis(1))
        const retry = vi.fn()
        expect(Array.from({length: 6}, () => policy.retry("failed", retry)))
            .toEqual([true, true, false, false, false, false])
        vi.runAllTimers()
        expect(retry).toHaveBeenCalledTimes(2)
    })
})

describe("Limit", () => {
    it("releases immediate and queued synchronous failures in FIFO order", async () => {
        const limit = new Promises.Limit<number>(1)
        const order: number[] = []
        const add = (index: number, fails: boolean) => limit.add(() => {
            order.push(index)
            if (fails) {throw new Error(`failed ${index}`)}
            return Promise.resolve(index)
        }).catch(() => -index)
        expect(await Promise.all([add(1, true), add(2, true), add(3, false)]))
            .toEqual([-1, -2, 3])
        expect(order).toEqual([1, 2, 3])
        expect(await add(4, false)).toBe(4)
    })
    it("bounds concurrency and releases asynchronously rejected work", async () => {
        const limit = new Promises.Limit<number>(2)
        let active = 0
        let peak = 0
        const tasks = Array.from({length: 6}, (_, index) => limit.add(async () => {
            peak = Math.max(peak, ++active)
            await Promise.resolve()
            active--
            if (index === 2) {throw new Error("async failure")}
            return index
        }).catch(() => -1))
        expect(await Promise.all(tasks)).toEqual([0, 1, -1, 3, 4, 5])
        expect(peak).toBe(2)
    })
})

it("keeps the current memoized promise when an expired predecessor rejects", async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<number>()
    const second = Promise.withResolvers<number>()
    const factory = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
        .mockResolvedValue(3)
    const memoized = Promises.memoizeAsync(factory, TimeSpan.millis(10))
    expect(memoized()).toBe(first.promise)
    vi.advanceTimersByTime(11)
    expect(memoized()).toBe(second.promise)
    first.reject("expired")
    await Promise.resolve()
    expect(memoized()).toBe(second.promise)
    expect(factory).toHaveBeenCalledTimes(2)
    second.reject("current")
    await Promise.resolve()
    expect(await memoized()).toBe(3)
    expect(factory).toHaveBeenCalledTimes(3)
})
