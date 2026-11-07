import {expect, it} from "vitest"
import {C64Noise} from "./noise"
it.each([0, 0.25, 1, 3.5])("matches independent integer LFSR clocks and exact reset replay (%s)", increment => {
    const noise = new C64Noise(increment * 1000, 1000)
    let state = 2 ** 23 - 1
    const expected = Array.from({length: 101}, (_, sample) => {
        const advances = Math.floor((sample + 1) * increment) - Math.floor(sample * increment)
        for (let i = 0; i < advances; i++) {
            const bit22 = Math.floor(state / 2 ** 22) % 2, bit17 = Math.floor(state / 2 ** 17) % 2
            state = (state * 2 + (bit22 === bit17 ? 0 : 1)) % 2 ** 23
        }
        return Math.floor(state / 2 ** 11) / 2047.5 - 1
    })
    const actual = Array.from({length: 101}, () => noise.process())
    expect(actual).toEqual(expected); expect(actual.every(x => x >= -1 && x <= 1)).toBe(true)
    noise.reset(); expect(Array.from({length: 101}, () => noise.process())).toEqual(actual)
})
