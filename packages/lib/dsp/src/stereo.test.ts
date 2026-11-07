import {describe, expect, it} from "vitest"
import {StereoMatrix} from "./stereo"
import {Mixing} from "./mixing"

const params: StereoMatrix.Params = {gain: 1, panning: 0, stereo: 0, invertL: false, invertR: false, swap: false}
const matrix = (changes: Partial<StereoMatrix.Params> = {}, mixing = Mixing.Linear) => {
    const value = StereoMatrix.zero()
    StereoMatrix.update(value, {...params, ...changes}, mixing)
    return value
}
const close = (actual: number[], expected: number[]) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6))
describe("StereoMatrix basis routing", () => {
    it("pins center pan laws and hard pan endpoints", () => {
        expect(matrix()).toEqual(StereoMatrix.identity())
        const [left, right] = StereoMatrix.panningToGains(0, Mixing.EqualPower)
        expect(left).toBeCloseTo(Math.SQRT1_2, 10)
        expect(right).toBeCloseTo(left, 10)
        expect(left * left + right * right).toBeCloseTo(1, 10)
        close(StereoMatrix.applyFrame(matrix({}, Mixing.EqualPower), 1, 1), [Math.SQRT1_2, Math.SQRT1_2])
        expect(StereoMatrix.applyFrame(matrix({panning: -1}), 2, 3)).toEqual([2, 0])
        expect(StereoMatrix.applyFrame(matrix({panning: 1}), 2, 3)).toEqual([0, 3])
    })
    it.each([
        [{stereo: -1}, [0.5, 0.5], [0.5, 0.5]],
        [{stereo: 1}, [1, -1], [-1, 1]],
        [{swap: true}, [0, 1], [1, 0]],
        [{invertL: true, invertR: true}, [-1, 0], [0, -1]],
        [{gain: 2, swap: true, invertL: true}, [0, 2], [-2, 0]]
    ] as const)("routes independent basis vectors for %j", (changes, left, right) => {
        const value = matrix(changes)
        close(StereoMatrix.applyFrame(value, 1, 0), [...left])
        close(StereoMatrix.applyFrame(value, 0, 1), [...right])
    })
    it("agrees for scalar, block and alias-safe in-place subranges", () => {
        const value = matrix({stereo: -0.4, swap: true, panning: 0.3, invertR: true})
        const source: StereoMatrix.Channels = [new Float32Array([77, 1, -2, 0.5, 88]), new Float32Array([77, 3, 4, -1, 88])]
        const target: StereoMatrix.Channels = [new Float32Array(5).fill(99), new Float32Array(5).fill(99)]
        StereoMatrix.processFrames(value, source, target, 1, 4)
        for (let index = 1; index < 4; index++) {close([target[0][index], target[1][index]], StereoMatrix.applyFrame(value, source[0][index], source[1][index]))}
        target.forEach(channel => {expect(channel[0]).toBe(99); expect(channel[4]).toBe(99)})
        const inplace: StereoMatrix.Channels = [source[0].slice(), source[1].slice()]
        StereoMatrix.replaceFrames(value, inplace, 1, 4)
        const alias: StereoMatrix.Channels = [source[0].slice(), source[1].slice()]
        StereoMatrix.processFrames(value, alias, alias, 1, 4)
        expect(alias).toEqual(inplace)
        inplace.forEach((channel, index) => expect(channel.slice(1, 4)).toEqual(target[index].slice(1, 4)))
    })
})
