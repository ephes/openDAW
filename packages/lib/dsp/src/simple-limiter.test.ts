import {describe, expect, it} from "vitest"
import {SimpleLimiter} from "./simple-limiter"
import {AudioBuffer} from "./AudioBuffer"

const fixture = () => {
    const buffer = new AudioBuffer()
    buffer.channels().forEach((channel, channelIndex) => channel.forEach((_, index) => {
        channel[index] = index < 5 || index > 100 ? 0 : (channelIndex === 0 ? 0.5 : 4) * (index % 2 ? -1 : 1)
    }))
    return buffer
}
const copy = (source: AudioBuffer) => {const target = new AudioBuffer(); source.replace(target); return target}
describe("SimpleLimiter linked envelope", () => {
    it("matches an independent attack/release recurrence and links the hot right channel", () => {
        const actual = fixture()
        const source = copy(actual)
        const attack = Math.exp(Math.log(0.01) / 3)
        const release = Math.exp(Math.log(0.01) / 20)
        let envelope = 0
        new SimpleLimiter(1000).replace(actual, 1, 127)
        for (let index = 1; index < 127; index++) {
            const left = source.getChannel(0)[index]
            const right = source.getChannel(1)[index]
            const peak = Math.max(Math.abs(left), Math.abs(right))
            const retention = peak > envelope ? attack : release
            envelope = retention * envelope + (1 - retention) * peak
            const gain = envelope > 1 ? 1 / envelope : 1
            expect(actual.getChannel(0)[index]).toBeCloseTo(left * gain, 6)
            expect(actual.getChannel(1)[index]).toBeCloseTo(right * gain, 6)
            if (right !== 0) {expect(actual.getChannel(0)[index] / actual.getChannel(1)[index]).toBeCloseTo(0.125, 6)}
        }
        expect(Math.abs(actual.getChannel(0)[50])).toBeLessThan(0.5)
        expect(actual.getChannel(0)[0]).toBe(source.getChannel(0)[0])
        expect(actual.getChannel(1)[127]).toBe(source.getChannel(1)[127])
    })
    it("preserves partition history and clear equals a fresh instance", () => {
        const whole = fixture()
        const split = copy(whole)
        const limiter = new SimpleLimiter(48000)
        new SimpleLimiter(48000).replace(whole, 0, 128)
        for (const [from, to] of [[0, 3], [3, 31], [31, 76], [76, 128]]) {limiter.replace(split, from, to)}
        expect(split.channels()).toEqual(whole.channels())
        limiter.clear()
        const reset = fixture()
        limiter.replace(reset, 0, 128)
        expect(reset.channels()).toEqual(whole.channels())
    })
    it.each([0, 1])("keeps constant %s inputs finite and unchanged", value => {
        const buffer = new AudioBuffer()
        buffer.channels().forEach(channel => channel.fill(value))
        new SimpleLimiter(48000).replace(buffer, 0, 128)
        buffer.channels().forEach(channel => expect(Array.from(channel)).toEqual(Array(128).fill(value)))
    })
})
