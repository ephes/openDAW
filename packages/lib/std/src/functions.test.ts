import {describe, expect, it} from "vitest"
import {AnyFunc, safeExecute} from "./lang"

describe("function call contracts", () => {
    it("retains calls through the public erased callback type", () => {
        const callback: AnyFunc = (value: number) => value * 2
        const result: number = callback(3)
        expect(result).toBe(6)
    })

    it("forwards arguments and results and skips absent callbacks", () => {
        expect(safeExecute((value: number, suffix: string) => `${value}${suffix}`, 3, "!" )).toBe("3!")
        expect(safeExecute(null)).toBeUndefined()
        expect(safeExecute(undefined)).toBeUndefined()
    })
})
