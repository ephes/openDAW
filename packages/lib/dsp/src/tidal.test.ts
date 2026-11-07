import {describe, expect, it} from "vitest"
import {TidalComputer} from "./tidal"

describe("TidalComputer shape invariants", () => {
    it("pins independent triangular gain values", () => {
        const computer = new TidalComputer()
        computer.set(1, 0, 0.5)
        for (const [phase, expected] of [[0, 0], [0.25, 0.5], [0.5, 1], [0.75, 0.5]]) {expect(computer.compute(phase)).toBeCloseTo(expected, 10)}
        computer.set(0.25, 0, 0.5)
        expect(computer.compute(0)).toBe(0.75)
        expect(computer.compute(0.25)).toBeCloseTo(0.875, 10)
    })
    it("is periodic, bounded and continuous at valid parameter extremes", () => {
        const computer = new TidalComputer()
        for (const depth of [0, 0.25, 1]) {
            for (const slope of [-1, -0.25, 0, 0.25, 1]) {
                for (const symmetry of [0, 0.25, 0.5, 0.75, 1]) {
                    computer.set(depth, slope, symmetry)
                    for (const phase of [0, 0.125, 0.25, 0.5, 0.75, 0.875]) {
                        const value = computer.compute(phase)
                        expect(Number.isFinite(value)).toBe(true)
                        expect(value).toBeGreaterThanOrEqual(1 - depth - 1e-10)
                        expect(value).toBeLessThanOrEqual(1 + 1e-10)
                        expect(computer.compute(phase + 2)).toBeCloseTo(value, 10)
                        expect(computer.compute(phase - 2)).toBeCloseTo(value, 10)
                        if (depth === 0) {expect(value).toBe(1)}
                    }
                }
            }
        }
    })
})

it("joins continuously at the symmetric midpoint without relying on private epsilon bounds", () => {
    const computer = new TidalComputer()
    for (const slope of [-1, -0.25, 0, 0.25, 1]) {
        computer.set(1, slope, 0.5)
        expect(computer.compute(0.5)).toBe(1)
        expect(computer.compute(0.5 - 1e-10)).toBeCloseTo(computer.compute(0.5 + 1e-10), 6)
    }
})
