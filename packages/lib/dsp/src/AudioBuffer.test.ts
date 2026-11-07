import {describe, expect, it} from "vitest"
import {AudioBuffer} from "./AudioBuffer"

describe("AudioBuffer mixing", () => {
    it.each([1, 2])("replaces and accumulates %s source channels", channels => {
        const source = new AudioBuffer(channels)
        source.getChannel(0).set([1, -2, 3, -4])
        if (channels === 2) {source.getChannel(1).set([5, 6, -7, -8])}
        const target = new AudioBuffer(2)
        target.getChannel(0).fill(10)
        target.getChannel(1).fill(-10)
        source.mixInto(target.channels())
        expect(Array.from(target.getChannel(0).slice(0, 5))).toEqual([11, 8, 13, 6, 10])
        expect(Array.from(target.getChannel(1).slice(0, 5))).toEqual(channels === 1 ? [-9, -12, -7, -14, -10] : [-5, -4, -17, -18, -10])
        source.replace(target)
        expect(target.getChannel(0)).toEqual(source.getChannel(0))
        expect(target.getChannel(1)).toEqual(source.getChannel(channels - 1))
        expect(source.getChannel(99)).toBe(source.getChannel(channels - 1))
    })
    it("clears only the requested half-open range", () => {
        const buffer = new AudioBuffer(2)
        buffer.channels().forEach(channel => channel.fill(7))
        buffer.clear(2, 5)
        buffer.channels().forEach(channel => {
            expect(Array.from(channel.slice(0, 7))).toEqual([7, 7, 0, 0, 0, 7, 7])
            expect(channel.at(-1)).toBe(7)
        })
    })
    it("rejects unsupported target and source layouts", () => {
        for (const channels of [1, 3]) {
            const target = new AudioBuffer(channels)
            expect(() => new AudioBuffer().replaceInto(target.channels())).toThrow()
            expect(() => new AudioBuffer().mixInto(target.channels())).toThrow()
        }
        expect(() => new AudioBuffer(3).replaceInto(new AudioBuffer().channels())).toThrow()
        expect(() => new AudioBuffer(3).mixInto(new AudioBuffer().channels())).toThrow()
    })
})
