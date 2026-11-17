import {describe, expect, it} from "vitest"
import {Float16} from "./numeric"

const decode = (bits: number): number => {
    const sign = bits & 0x8000 ? -1 : 1
    const exponent = bits >>> 10 & 31
    const fraction = bits & 1023
    return exponent === 31 ? fraction === 0 ? sign * Infinity : NaN
        : sign * (exponent === 0 ? fraction * 2 ** -24 : (1024 + fraction) * 2 ** (exponent - 25))
}

describe("binary16", () => {
    it("expands every bit pattern exactly, including signed zero", () => {
        for (let bits = 0; bits < 65536; bits++) {
            expect(Object.is(Float16.intBitsToFloat(bits), decode(bits)), bits.toString(16)).toBe(true)
        }
    })
    it("rounds every adjacent finite midpoint to the even significand", () => {
        for (let bits = 0; bits < 0x7bff; bits++) {
            const midpoint = (decode(bits) + decode(bits + 1)) / 2
            const expected = bits + (bits & 1)
            expect(Float16.floatToIntBits(midpoint), bits.toString(16)).toBe(expected)
            expect(Float16.floatToIntBits(-midpoint)).toBe(expected | 0x8000)
        }
    })
    it("retains finite round trips and the established overflow policy", () => {
        for (let bits = 0; bits < 0x7c00; bits++) {
            expect(Float16.floatToIntBits(decode(bits))).toBe(bits)
        }
        expect(Float16.floatToIntBits(65519)).toBe(0x7bff)
        expect(Float16.floatToIntBits(65520)).toBe(0x7bff)
        expect(Float16.floatToIntBits(65536)).toBe(0x7c00)
        expect(Float16.floatToIntBits(-Infinity)).toBe(0xfc00)
        expect(Number.isNaN(Float16.intBitsToFloat(Float16.floatToIntBits(NaN)))).toBe(true)
    })
})
