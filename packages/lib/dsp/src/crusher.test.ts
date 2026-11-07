import {describe, expect, it} from "vitest"
import {Crusher} from "./crusher"
import {StereoMatrix} from "./stereo"

const fixture = (): StereoMatrix.Channels => [
    Float32Array.from({length: 128}, (_, index) => Math.sin(index * 0.19) * 0.7),
    Float32Array.from({length: 128}, (_, index) => Math.cos(index * 0.31) * 0.4)
]
const create = () => {const crusher = new Crusher(8000); crusher.setCrush(0.85); crusher.setBitDepth(5); crusher.setMix(0.7); return crusher}
const output = (): StereoMatrix.Channels => [new Float32Array(128).fill(77), new Float32Array(128).fill(77)]
describe("Crusher state and block partitions", () => {
    it("dry mix at zero boost equals input within the requested range", () => {
        const crusher = create()
        crusher.setMix(0)
        crusher.setBoost(0)
        const source = fixture()
        const target = output()
        crusher.process(source, target, 2, 126)
        target.forEach((channel, index) => {
            expect(channel.slice(2, 126)).toEqual(source[index].slice(2, 126))
            expect(channel[1]).toBe(77)
            expect(channel[126]).toBe(77)
        })
    })
    it.each([false, true])("is partition-invariant with transition=%s", transition => {
        const source = fixture()
        const whole = create()
        const split = create()
        const actual = output()
        const expected = output()
        whole.process(source, expected, 0, 16)
        split.process(source, actual, 0, 16)
        if (transition) {whole.setCrush(0.2); split.setCrush(0.2)}
        whole.process(source, expected, 16, 128)
        for (const [from, to] of [[16, 31], [31, 73], [73, 128]]) {split.process(source, actual, from, to)}
        actual.forEach((channel, channelIndex) => channel.forEach((value, index) => {
            expect(Number.isFinite(value)).toBe(true)
            expect(value).toBeCloseTo(expected[channelIndex][index], 6)
        }))
    })
    it("reset followed by the same configuration matches a fresh effect", () => {
        const crusher = create()
        crusher.process(fixture(), output(), 0, 128)
        crusher.setCrush(0.2)
        crusher.process(fixture(), output(), 0, 128)
        crusher.reset()
        crusher.setCrush(0.85)
        const actual = output()
        const expected = output()
        crusher.process(fixture(), actual, 0, 128)
        create().process(fixture(), expected, 0, 128)
        expect(actual).toEqual(expected)
    })
    it("keeps channel histories independent under channel exchange", () => {
        const source = fixture()
        const actual = output()
        const swapped = output()
        create().process(source, actual, 0, 128)
        create().process([source[1], source[0]], swapped, 0, 128)
        expect(actual[0]).toEqual(swapped[1])
        expect(actual[1]).toEqual(swapped[0])
    })
})
