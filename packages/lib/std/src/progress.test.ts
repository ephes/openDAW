import {afterEach, describe, expect, it, vi} from "vitest"
import {Progress} from "./progress"

afterEach(() => vi.restoreAllMocks())
describe("progress fanout", () => {
    it.each([false, true])("matches independent replacement accounting (weighted=%s)", weighted => {
        const weights = weighted ? [1, 3, 6] : [1, 1, 1]
        const values = [0, 0, 0]
        const reports: Array<number> = []
        const children = weighted ? Progress.splitWithWeights(value => reports.push(value), weights)
            : Progress.split(value => reports.push(value), 3)
        for (const [index, value] of [[0, 0.3], [1, 0.9], [1, 0.9], [1, 0.1], [2, 1], [0, 1], [1, 1]]) {
            values[index] = value
            children[index](value)
            const reference = values.reduce((sum, current, slot) => sum + current * weights[slot], 0)
                / weights.reduce((sum, weight) => sum + weight, 0)
            expect(reports.at(-1)).toBeCloseTo(reference, 12)
        }
    })
    it.each([NaN, Infinity, -Infinity, 0, -1])("rejects invalid weight %s before any progress", weight => {
        const report = vi.fn()
        expect(() => Progress.splitWithWeights(report, [1, weight])).toThrow()
        expect(report).not.toHaveBeenCalled()
    })
    it("normalizes finite weights whose sum overflows", () => {
        const reports: Array<number> = []
        const children = Progress.splitWithWeights(value => reports.push(value), [Number.MAX_VALUE, Number.MAX_VALUE])
        children[0](1)
        children[1](1)
        expect(reports).toEqual([0.5, 1])
    })
    it.each([false, true])("bounds accounting for 10000 children (weighted=%s)", weighted => {
        const count = 10000
        const reduce32 = vi.spyOn(Float32Array.prototype, "reduce")
        const reduce64 = vi.spyOn(Float64Array.prototype, "reduce")
        const report = vi.fn()
        const children = weighted ? Progress.splitWithWeights(report, Array.from({length: count}, () => 1))
            : Progress.split(report, count)
        children.forEach(child => child(1))
        // Count slots traversed by whole-collection accounting, independently of wall-clock timing.
        const visits = reduce32.mock.contexts.concat(reduce64.mock.contexts)
            .reduce<number>((total, context) => total + (context as Float32Array).length, 0)
        expect(visits).toBeLessThanOrEqual(3 * count)
        expect(report).toHaveBeenCalledTimes(count)
        expect(report.mock.lastCall?.[0]).toBeCloseTo(1, 10)
    })
    it("keeps empty split behavior and rejects empty weighted input", () => {
        expect(Progress.split(vi.fn(), 0)).toEqual([])
        expect(() => Progress.splitWithWeights(vi.fn(), [])).toThrow()
    })
})
