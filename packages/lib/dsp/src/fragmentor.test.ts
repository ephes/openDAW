import {describe, expect, it} from "vitest"
import {Fragmentor} from "./fragmentor"

describe("Fragmentor half-open grid windows", () => {
    it.each([
        [-1, 1, 0.25, [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]],
        [-0.7, 0.8, 0.5, [-0.5, 0, 0.5]],
        [0.25, 1, 0.25, [0.25, 0.5, 0.75]],
        [1, 1, 0.25, []], [2, 1, 0.25, []], [0.1, 0.2, 1, []]
    ] as const)("enumerates [%s,%s) at step%s", (from, to, step, expected) => {
        expect(Array.from(Fragmentor.iterate(from, to, step))).toEqual([...expected])
        const indexed = Array.from(Fragmentor.iterateWithIndex(from, to, step))
        expect(indexed.map(entry => entry.position)).toEqual([...expected])
        indexed.forEach(entry => {
            expect(Number.isInteger(entry.index)).toBe(true)
            expect(entry.position).toBe(entry.index * step)
        })
    })
    it.each([0.125, 0.5, 2])("adjacent partitions neither duplicate nor drop boundaries at step%s", step => {
        const boundaries = [-2.25, -0.5, 0, 0.375, 1, 2.75]
        const pieces = boundaries.slice(0, -1).flatMap((from, index) => Array.from(Fragmentor.iterate(from, boundaries[index + 1], step)))
        const whole = Array.from(Fragmentor.iterate(boundaries[0], boundaries.at(-1)!, step))
        const expected = Array.from({length: 65}, (_, index) => (index - 32) * step).filter(value => value >= -2.25 && value < 2.75)
        expect(whole).toEqual(expected)
        expect(pieces).toEqual(whole)
        expect(new Set(pieces).size).toBe(pieces.length)
    })
})
