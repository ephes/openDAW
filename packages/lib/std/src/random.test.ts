import {expect, it} from "vitest"
import {Mulberry32} from "./random"

it("matches a wrapped reference across the long-stream precision boundary", () => {
    const random = new Mulberry32(1)
    const state = new Uint32Array([1])
    let firstMismatch = -1
    let boundaryValue = 0
    for (let draw = 1; draw <= 4_917_824; draw++) {
        state[0] += 0x6D2B79F5
        let mixed = Math.imul(state[0] ^ state[0] >>> 15, state[0] | 1)
        mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61)
        const expected = ((mixed ^ mixed >>> 14) >>> 0) / 2 ** 32
        const actual = random.uniform()
        if (actual !== expected && firstMismatch === -1) {firstMismatch = draw}
        if (draw === 4_917_760) {boundaryValue = actual}
    }
    expect(firstMismatch).toBe(-1)
    expect(boundaryValue).toBe(0.26924679218791425)
    random.setSeed(1)
    expect(random.uniform()).toBe(0.6270739405881613)
})

it.each([0, 1, -1, 0x80000000, 0xFFFFFFFF])("preserves seed equivalence and reset replay: %s", seed => {
    const random = new Mulberry32(seed)
    const signed = new Mulberry32(seed | 0)
    const unsigned = new Mulberry32(seed >>> 0)
    const sequence = Array.from({length: 32}, () => random.uniform())
    expect(Array.from({length: 32}, () => signed.uniform())).toEqual(sequence)
    expect(Array.from({length: 32}, () => unsigned.uniform())).toEqual(sequence)
    random.setSeed(seed)
    expect(Array.from({length: 32}, () => random.uniform())).toEqual(sequence)
})
