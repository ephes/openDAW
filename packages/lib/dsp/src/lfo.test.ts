import {describe, expect, it} from "vitest"
import {LFO} from "./lfo"
import {ClassicWaveform} from "./classic-waveform"

const cases = [
    [ClassicWaveform.sine, [0, 1, 0, -1]],
    [ClassicWaveform.triangle, [1, 0, -1, 0]],
    [ClassicWaveform.saw, [-1, -0.5, 0, 0.5]],
    [ClassicWaveform.square, [1, 1, -1, -1]]
] as const
describe("LFO phase/reset", () => {
    it.each(cases)("pins quarter cycles, partitions and reset for %s", (shape, quarter) => {
        const whole = new Float32Array(18).fill(77)
        const split = whole.slice()
        const lfo = new LFO(8)
        lfo.fill(whole, shape, 1, 1, 17)
        for (let index = 0; index < 4; index++) {expect(whole[1 + index * 2]).toBeCloseTo(quarter[index], 6)}
        const partitioned = new LFO(8)
        for (const [from, to] of [[1, 2], [2, 7], [7, 10], [10, 17]]) {partitioned.fill(split, shape, 1, from, to)}
        expect(split).toEqual(whole)
        expect(whole[0]).toBe(77)
        expect(whole[17]).toBe(77)
        lfo.reset()
        const reset = new Float32Array(16)
        lfo.fill(reset, shape, 1, 0, 16)
        expect(reset).toEqual(whole.slice(1, 17))
    })
    it("preserves phase while switching shape", () => {
        const lfo = new LFO(8)
        const output = new Float32Array(8)
        lfo.fill(output, ClassicWaveform.sine, 1, 0, 3)
        lfo.fill(output, ClassicWaveform.saw, 1, 3, 4)
        expect(output[3]).toBe(-0.25)
        lfo.fill(output, ClassicWaveform.square, 1, 4, 5)
        expect(output[4]).toBe(-1)
    })
})
