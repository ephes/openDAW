import {expect, it} from "vitest"
import {CrestFactor} from "./CrestFactor"
it("uses only selected squared samples and preserves state for empty spans", () => {
    const run = (prefix: number, sign: number) => {
        const c = new CrestFactor(1000)
        c.process(new Float32Array([prefix, sign * 0.1, sign * 0.1, 99]), 1, 3)
        return c
    }
    const c = run(0, 1), reference = [c.getAvgAttack(), c.getAvgRelease()]
    expect(reference[0]).toBeCloseTo(0.16, 10); expect(reference[1]).toBeCloseTo(1.84, 10)
    for (const prefix of [10, -10]) for (const sign of [1, -1]) {
        const other = run(prefix, sign)
        expect([other.getAvgAttack(), other.getAvgRelease()]).toEqual(reference)
    }
    c.process(new Float32Array(), 0, 0)
    expect([c.getAvgAttack(), c.getAvgRelease()]).toEqual(reference)
    c.process(new Float32Array(100), 0, 100)
    expect(Number.isFinite(c.getAvgAttack()) && Number.isFinite(c.getAvgRelease())).toBe(true)
    const silent = new CrestFactor(1000); silent.process(new Float32Array(), 0, 0)
    expect([silent.getAvgAttack(), silent.getAvgRelease()].every(Number.isFinite)).toBe(true)
})
