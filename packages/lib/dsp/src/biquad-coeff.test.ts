import {describe, expect, it} from "vitest"
import {BiquadCoeff} from "./biquad-coeff"

const response = (coeff: BiquadCoeff, frequencies: number[]) => {
    const frequency = Float32Array.from(frequencies)
    const magnitude = new Float32Array(frequency.length)
    const phase = new Float32Array(frequency.length)
    coeff.getFrequencyResponse(frequency, magnitude, phase)
    return {frequency, magnitude, phase}
}
const modes = [
    new BiquadCoeff(),
    new BiquadCoeff().setLowpassParams(0.125, 0.7),
    new BiquadCoeff().setHighpassParams(0.125, 1.2),
    new BiquadCoeff().setLowShelfParams(0.125, 6),
    new BiquadCoeff().setHighShelfParams(0.125, -6),
    new BiquadCoeff().setPeakingParams(0.125, 2, 6),
    new BiquadCoeff().setNotchParams(0.125, 1),
    new BiquadCoeff().setBandpassParams(0.125, 1),
    new BiquadCoeff().setAllpassParams(0.125, 1)
]
describe("BiquadCoeff independent response", () => {
    it.each(modes.map((coeff, index) => [index, coeff] as const))("matches an impulse DFT for mode %s", (_, coeff) => {
        const {frequency, magnitude, phase} = response(coeff, [0.03125, 0.09375, 0.1875, 0.375])
        const impulse: number[] = []
        for (let index = 0; index < 1024; index++) {
            impulse.push((index === 0 ? coeff.b0 : index === 1 ? coeff.b1 : index === 2 ? coeff.b2 : 0)
                - coeff.a1 * (impulse[index - 1] ?? 0) - coeff.a2 * (impulse[index - 2] ?? 0))
        }
        frequency.forEach((value, bin) => {
            let real = 0
            let imaginary = 0
            impulse.forEach((sample, index) => {
                const angle = -2 * Math.PI * value * index
                real += sample * Math.cos(angle)
                imaginary += sample * Math.sin(angle)
            })
            expect(Number.isFinite(magnitude[bin])).toBe(true)
            expect(magnitude[bin]).toBeCloseTo(Math.hypot(real, imaginary), 5)
            expect(Math.cos(phase[bin])).toBeCloseTo(Math.cos(Math.atan2(imaginary, real)), 5)
            expect(Math.sin(phase[bin])).toBeCloseTo(Math.sin(Math.atan2(imaginary, real)), 5)
        })
    })
    it("pins identity, passband/stopband limits and center gains", () => {
        const identity = response(new BiquadCoeff(), [0, 0.125, 0.5])
        expect(Array.from(identity.magnitude)).toEqual([1, 1, 1])
        expect(Array.from(identity.phase)).toEqual([0, 0, 0])
        const low = response(modes[1], [0, 0.5]).magnitude
        const high = response(modes[2], [0, 0.5]).magnitude
        expect(low[0]).toBeCloseTo(1, 6)
        expect(low[1]).toBeCloseTo(0, 6)
        expect(high[0]).toBeCloseTo(0, 6)
        expect(high[1]).toBeCloseTo(1, 6)
        expect(response(modes[5], [0.125]).magnitude[0]).toBeCloseTo(10 ** (6 / 20), 6)
        expect(response(modes[6], [0.125]).magnitude[0]).toBeCloseTo(0, 6)
        expect(response(modes[7], [0.125]).magnitude[0]).toBeCloseTo(1, 6)
        expect(response(modes[3], [0]).magnitude[0]).toBeCloseTo(10 ** (6 / 20), 6)
        expect(response(modes[4], [0.5]).magnitude[0]).toBeCloseTo(10 ** (-6 / 20), 6)
    })
    it("keeps allpass magnitude unity and zero-dB shelf/peak neutral", () => {
        const frequencies = [0, 0.02, 0.125, 0.3, 0.5]
        for (const coeff of [modes[8], new BiquadCoeff().setLowShelfParams(0.125, 0),
            new BiquadCoeff().setHighShelfParams(0.125, 0), new BiquadCoeff().setPeakingParams(0.125, 2, 0)]) {
            response(coeff, frequencies).magnitude.forEach(value => expect(value).toBeCloseTo(1, 6))
        }
    })
})
