import {describe, expect, it} from "vitest"
import {BandLimitedOscillator} from "./osc"
import {ClassicWaveform} from "./classic-waveform"

const waveforms = [ClassicWaveform.sine, ClassicWaveform.triangle, ClassicWaveform.saw, ClassicWaveform.square]
describe("BandLimitedOscillator frequency parity", () => {
    it.each(waveforms)("preserves waveform %s across constant/buffer/partitioned calls", waveform => {
        const whole = new Float32Array(130).fill(77)
        const buffered = whole.slice()
        const split = whole.slice()
        const splitBuffered = whole.slice()
        const frequency = new Float32Array(130).fill(1000)
        new BandLimitedOscillator(8000).generate(whole, 1000, waveform, 1, 129)
        new BandLimitedOscillator(8000).generateFromFrequencies(buffered, frequency, waveform, 1, 129)
        const constantOscillator = new BandLimitedOscillator(8000)
        const bufferedOscillator = new BandLimitedOscillator(8000)
        for (const [from, to] of [[1, 4], [4, 33], [33, 65], [65, 111], [111, 129]]) {
            constantOscillator.generate(split, 1000, waveform, from, to)
            bufferedOscillator.generateFromFrequencies(splitBuffered, frequency, waveform, from, to)
        }
        expect(buffered).toEqual(whole)
        expect(split).toEqual(whole)
        expect(splitBuffered).toEqual(whole)
        expect(whole[0]).toBe(77)
        expect(whole[129]).toBe(77)
        whole.subarray(1, 129).forEach(value => {expect(Number.isFinite(value)).toBe(true); expect(Math.abs(value)).toBeLessThanOrEqual(2.1)})
    })
    it("matches an analytic sine with phase starting at the requested range", () => {
        const output = new Float32Array(130).fill(77)
        new BandLimitedOscillator(8000).generate(output, 125, ClassicWaveform.sine, 1, 129)
        for (let index = 1; index < 129; index++) {expect(output[index]).toBeCloseTo(Math.sin(2 * Math.PI * (index - 1) / 64), 6)}
    })
    it("indexes varying frequencies at a nonzero offset and preserves cumulative sine phase", () => {
        const frequencies = Float32Array.from({length: 34}, (_, index) => index === 0 ? 9999 : 200 + index * 13)
        const whole = new Float32Array(34).fill(77)
        const split = whole.slice()
        new BandLimitedOscillator(8000).generateFromFrequencies(whole, frequencies, ClassicWaveform.sine, 1, 33)
        const oscillator = new BandLimitedOscillator(8000)
        for (const [from, to] of [[1, 3], [3, 12], [12, 33]]) {oscillator.generateFromFrequencies(split, frequencies, ClassicWaveform.sine, from, to)}
        expect(split).toEqual(whole)
        let phase = 0
        for (let index = 1; index < 33; index++) {
            expect(whole[index]).toBeCloseTo(Math.sin(2 * Math.PI * phase), 6)
            phase += frequencies[index] / 8000
        }
        expect(whole[0]).toBe(77)
        expect(whole[33]).toBe(77)
    })
    it.each(waveforms)("keeps zero frequency finite for waveform %s", waveform => {
        const constant = new Float32Array(16)
        const buffered = new Float32Array(16)
        new BandLimitedOscillator(8000).generate(constant, 0, waveform, 0, 16)
        new BandLimitedOscillator(8000).generateFromFrequencies(buffered, new Float32Array(16), waveform, 0, 16)
        expect(constant).toEqual(buffered)
        expect(constant.every(Number.isFinite)).toBe(true)
    })
})
