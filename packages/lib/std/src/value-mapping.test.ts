import {describe, expect, it} from "vitest"
import {ValueMapping} from "./value-mapping"

describe("discrete mapping domains", () => {
    it("defines a finite coordinate for a singleton", () => {
        const mapping = ValueMapping.values(["only"])
        expect(mapping.x("only")).toBe(0)
        for (const coordinate of [-1, 0, 0.5, 1, 2]) {expect(mapping.y(coordinate)).toBe("only")}
        expect(() => mapping.x("missing")).toThrow()
    })
    it("rejects empty value lists", () => {expect(() => ValueMapping.values([])).toThrow()})
    it.each([[3, 3], [4, 2], [1.1, 1.4], [3e20, 4e20], [NaN, 2]])(
        "rejects non-increasing rounded integer bounds %s..%s", (min, max) => {
            expect(() => ValueMapping.linearInteger(min, max)).toThrow()
        })
    it("rounds and clamps valid fractional negative bounds", () => {
        const mapping = ValueMapping.linearInteger(-2.4, 4.4)
        expect(mapping.y(0)).toBe(-2)
        expect(mapping.y(1)).toBe(4)
        expect(mapping.y(0.5)).toBe(1)
        expect(mapping.x(1)).toBe(0.5)
        expect(mapping.clamp(-100)).toBe(-2)
        expect(mapping.clamp(100)).toBe(4)
        expect(mapping.clamp(-0.6)).toBe(-1)
        expect(mapping.floating()).toBe(false)
    })
})
describe("continuous mapping inverses", () => {
    it.each([
        ["linear", ValueMapping.linear(-10, 30), -10, 30],
        ["exponential", ValueMapping.exponential(20, 20000), 20, 20000],
        ["power", ValueMapping.power(2, 0, 16), 0, 16],
        ["powerByCenter", ValueMapping.powerByCenter(4, 0, 16), 0, 16]
    ] as const)("roundtrips and clamps %s", (_, mapping, min, max) => {
        for (let index = 0; index <= 200; index++) {
            const coordinate = index / 200
            expect(mapping.x(mapping.y(coordinate))).toBeCloseTo(coordinate, 8)
        }
        expect(mapping.y(-1)).toBe(min)
        expect(mapping.y(2)).toBe(max)
        expect(mapping.x(min - 1)).toBe(0)
        expect(mapping.x(max + 1)).toBe(1)
        expect(mapping.clamp(min - 1)).toBe(min)
        expect(mapping.clamp(max + 1)).toBe(max)
        expect(mapping.floating()).toBe(true)
    })
    it("pins independent linear/geometric/power midpoints", () => {
        expect(ValueMapping.linear(-10, 30).y(0.5)).toBe(10)
        expect(ValueMapping.exponential(20, 20000).y(0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 8)
        expect(ValueMapping.power(2, 0, 16).y(0.25)).toBe(1)
        expect(ValueMapping.powerByCenter(4, 0, 16).y(0.5)).toBe(4)
        expect(ValueMapping.powerByCenter(4, 0, 16).x(4)).toBe(0.5)
    })
    it("pins DefaultDecibel silence, endpoints and -12dB midpoint", () => {
        const mapping = ValueMapping.DefaultDecibel
        expect(mapping.y(0)).toBe(-Infinity)
        expect(mapping.x(-Infinity)).toBe(0)
        expect(mapping.x(-72)).toBe(0)
        expect(mapping.y(1)).toBe(0)
        expect(mapping.y(0.5)).toBeCloseTo(-12, 10)
        expect(mapping.x(-12)).toBeCloseTo(0.5, 10)
        expect(mapping.y(-1)).toBe(-Infinity)
        expect(mapping.y(2)).toBe(0)
        for (let index = 1; index <= 200; index++) {
            const coordinate = index / 200
            expect(mapping.x(mapping.y(coordinate))).toBeCloseTo(coordinate, 8)
        }
    })
})
