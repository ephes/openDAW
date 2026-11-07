import {describe, expect, it} from "vitest"
import {Waveshaper} from "./waveshaper"

describe("Waveshaper display/audio parity", () => {
    it.each(Waveshaper.Equations)("matches scalar %s on unequal stereo channels and subranges", equation => {
        const values = [-2, -1.0001, -1, -0.9999, -2 / 3 - 0.0001, -2 / 3, -2 / 3 + 0.0001, -0.5, 0, 0.5, 0.9999, 1, 1.0001, 2]
        const left = new Float32Array([77, ...values, 88])
        const right = new Float32Array([77, ...values.map(value => -value * 0.7), 88])
        const original = [left.slice(), right.slice()]
        Waveshaper.process([left, right], equation, 1, left.length - 1)
        for (const [channelIndex, channel] of [left, right].entries()) {
            expect(channel[0]).toBe(77)
            expect(channel.at(-1)).toBe(88)
            for (let index = 1; index < channel.length - 1; index++) {
                expect(channel[index]).toBeCloseTo(Waveshaper.apply(original[channelIndex][index], equation), 6)
                expect(Number.isFinite(channel[index])).toBe(true)
            }
        }
    })
    it.each([
        ["hardclip", 1], ["cubicSoft", 1], ["tanh", (Math.E ** 2 - 1) / (Math.E ** 2 + 1)],
        ["sigmoid", 1 - 1 / Math.E], ["arctan", 0.5]
    ] as const)("pins independent %s endpoints and odd symmetry", (equation, endpoint) => {
        expect(Waveshaper.apply(0, equation)).toBe(0)
        expect(Waveshaper.apply(1, equation)).toBeCloseTo(endpoint, 12)
        expect(Waveshaper.apply(-1, equation)).toBeCloseTo(-endpoint, 12)
        for (const value of [0.1, 0.5, 0.9, 1.5]) {expect(Waveshaper.apply(-value, equation)).toBeCloseTo(-Waveshaper.apply(value, equation), 12)}
    })
    it("pins cubic and asymmetric breakpoints independently", () => {
        expect(Waveshaper.apply(0.5, "cubicSoft")).toBe(0.6875)
        for (const [value, expected] of [[-2, -1], [-1, -1], [-2 / 3, -2 / 3], [-0.5, -0.5], [0, 0], [0.5, 1 / 3], [1, 0.5]]) {
            expect(Waveshaper.apply(value, "asymmetric")).toBeCloseTo(expected, 12)
        }
    })
})
