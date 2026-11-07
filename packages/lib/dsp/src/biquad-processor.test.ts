import {describe, expect, it} from "vitest"
import {BiquadMono, BiquadStack, ModulatedBiquad} from "./biquad-processor"
import {BiquadCoeff} from "./biquad-coeff"

const input = Float32Array.from({length: 64}, (_, index) => index === 0 ? 1 : Math.sin(index * 0.3) * 0.1)
const coeff = new BiquadCoeff().setNormalizedCoefficients(0.2, 0.1, 0.05, 1, -0.4, 0.12)
const close = (actual: Float32Array, expected: Float32Array) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6))
const reference = (source: Float32Array, order: number) => {
    let values = source.slice()
    for (let stage = 0; stage < order; stage++) {
        const result = new Float32Array(values.length)
        const history: number[] = []
        for (let index = 0; index < values.length; index++) {
            const output = 0.2 * values[index] + 0.1 * (values[index - 1] ?? 0) + 0.05 * (values[index - 2] ?? 0)
                + 0.4 * (history[index - 1] ?? 0) - 0.12 * (history[index - 2] ?? 0)
            history.push(output)
            result[index] = output
        }
        values = result
    }
    return values
}
describe("biquad frame and block history", () => {
    it.each([1, 2, 3, 4])("matches a reference cascade at order %s", order => {
        const stack = new BiquadStack(4)
        stack.order = order
        const actual = new Float32Array(64)
        stack.process(coeff, input, actual, 0, 64)
        close(actual, reference(input, order))
        const partitioned = input.slice()
        stack.reset()
        for (const [from, to] of [[0, 1], [1, 7], [7, 31], [31, 64]]) {stack.process(coeff, partitioned, partitioned, from, to)}
        close(partitioned, actual)
        stack.reset()
        const frames = Float32Array.from(input, value => stack.processFrame(coeff, value))
        close(frames, actual)
    })
    it("mono reset and ranges match a fresh filter", () => {
        const filter = new BiquadMono()
        filter.process(coeff, input, new Float32Array(64), 0, 64)
        filter.reset()
        const actual = new Float32Array(64).fill(77)
        const expected = actual.slice()
        filter.process(coeff, input, actual, 2, 61)
        new BiquadMono().process(coeff, input, expected, 2, 61)
        expect(actual).toEqual(expected)
        expect(actual.slice(0, 2)).toEqual(new Float32Array([77, 77]))
        expect(actual[61]).toBe(77)
        const frameFilter = new BiquadMono()
        const frames = Float32Array.from(input.subarray(2, 61), value => frameFilter.processFrame(coeff, value))
        close(actual.subarray(2, 61), frames)
    })
    it("order changes reset cascade history", () => {
        const stack = new BiquadStack(4)
        stack.process(coeff, input, new Float32Array(64), 0, 64)
        stack.order = 2
        const actual = new Float32Array(64)
        stack.process(coeff, input, actual, 0, 64)
        close(actual, reference(input, 2))
    })
})
describe("ModulatedBiquad coefficient cache", () => {
    it.each(["q", "order"])("refreshes fixed-cutoff coefficients when %s changes", parameter => {
        const create = () => new ModulatedBiquad(100, 10000, 48000)
        const filter = create()
        const cutoffs = new Float32Array(64).fill(0.5)
        const impulse = new Float32Array(64)
        impulse[0] = 1
        const before = new Float32Array(64)
        filter.process(impulse, before, cutoffs, 0.7, 0, 64)
        filter.reset()
        const q = parameter === "q" ? 5 : 0.7
        const order = parameter === "order" ? 2 : 4
        filter.order = order
        const actual = new Float32Array(64)
        filter.process(impulse, actual, cutoffs, q, 0, 0)
        filter.process(impulse, actual, cutoffs, q, 0, 64)
        const fresh = create()
        fresh.order = order
        const expected = new Float32Array(64)
        fresh.process(impulse, expected, cutoffs, q, 0, 64)
        close(actual, expected)
        expect(Math.max(...actual.map((value, index) => Math.abs(value - before[index])))).toBeGreaterThan(1e-4)
    })
    it("preserves unchanged-parameter continuity across blocks", () => {
        const whole = new ModulatedBiquad(100, 10000, 48000)
        const split = new ModulatedBiquad(100, 10000, 48000)
        const cutoff = new Float32Array(64).fill(0.5)
        const actual = new Float32Array(64)
        const expected = new Float32Array(64)
        whole.process(input, expected, cutoff, 0.7, 0, 64)
        split.process(input, actual, cutoff, 0.7, 0, 13)
        split.process(input, actual, cutoff, 0.7, 13, 64)
        expect(actual).toEqual(expected)
    })
})
