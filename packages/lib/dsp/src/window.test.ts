import {expect, it} from "vitest"
import {Window} from "./window"
const tables = [
    [Window.Type.Bartlett, (x: number) => 1 - Math.abs(2 * x - 1)],
    [Window.Type.Blackman, (x: number) => 0.42323 - 0.49755 * Math.cos(2 * Math.PI * x) + 0.07922 * Math.cos(4 * Math.PI * x)],
    [Window.Type.BlackmanHarris, (x: number) => 0.35875 - 0.48829 * Math.cos(2 * Math.PI * x) + 0.14128 * Math.cos(4 * Math.PI * x) - 0.01168 * Math.cos(6 * Math.PI * x)],
    [Window.Type.Hamming, (x: number) => 0.54 - 0.46 * Math.cos(2 * Math.PI * x)],
    [Window.Type.Hanning, (x: number) => (1 - Math.cos(2 * Math.PI * x)) / 2]
] as const
it.each([2, 5, 8, 17])("matches independent window coefficients, symmetry and energy (n=%s)", n => {
    for (const [type, formula] of tables) {
        const values = Window.create(type, n)
        let energy = 0
        values.forEach((value, i) => {
            const expected = formula(i / (n - 1)); energy += expected * expected
            expect(value).toBeCloseTo(expected, 6); expect(value).toBeCloseTo(values[n - i - 1], 6)
        })
        expect(values.reduce((sum, x) => sum + x * x, 0)).toBeCloseTo(energy, 5)
    }
})
it.each([0, 1, -1, 2.5, NaN, Infinity])("rejects unsupported window length %s", n => {
    expect(() => Window.create(Window.Type.Hanning, n)).toThrow(RangeError)
})
