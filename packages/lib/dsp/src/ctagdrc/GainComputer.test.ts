import {expect, it} from "vitest"
import {GainComputer} from "./GainComputer"
it("matches hard-knee attenuation and ratio-one identity", () => {
    const g = new GainComputer(); g.setThreshold(-20); g.setKnee(0); g.setRatio(4)
    expect([-30, -20, -16, 0].map(x => g.applyCompression(x))).toEqual([0, 0, -3, -15])
    g.setRatio(1)
    for (const x of [-80, -20, 0, 20]) expect(g.applyCompression(x)).toBe(0)
})
it("has continuous soft-knee values and slopes and processes only the selected span", () => {
    const g = new GainComputer(); g.setThreshold(-20); g.setRatio(4); g.setKnee(8)
    const eps = 1e-4
    for (const [edge, value, slope] of [[-24, 0, 0], [-16, -3, -0.75]]) {
        expect(g.applyCompression(edge)).toBeCloseTo(value, 8)
        expect((g.applyCompression(edge) - g.applyCompression(edge - eps)) / eps).toBeCloseTo(slope, 4)
        expect((g.applyCompression(edge + eps) - g.applyCompression(edge)) / eps).toBeCloseTo(slope, 4)
    }
    const b = new Float32Array([99, 0, -0.1, 1, 99]), original = b.slice()
    g.applyCompressionToBuffer(b, 1, 4)
    expect(b[0]).toBe(99); expect(b[4]).toBe(99)
    for (let i = 1; i < 4; i++) expect(b[i]).toBeCloseTo(g.applyCompression(20 * Math.log10(Math.max(Math.abs(original[i]), 1e-6))), 5)
})
