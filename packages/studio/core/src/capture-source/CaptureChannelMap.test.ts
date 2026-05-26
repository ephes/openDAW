import {describe, expect, it} from "vitest"
import {CaptureChannelMap} from "./CaptureChannelMap"

const channel = (...values: number[]): Float32Array => Float32Array.from(values)

describe("CaptureChannelMap", () => {
    it("identity maps every channel onto itself", () => {
        expect(Array.from(CaptureChannelMap.identity(4))).toEqual([0, 1, 2, 3])
        expect(CaptureChannelMap.isIdentity(CaptureChannelMap.identity(4))).toBe(true)
    })

    it("swap inverts a two-channel layout", () => {
        const map = CaptureChannelMap.swap(0, 1)
        expect(Array.from(map)).toEqual([1, 0])
        expect(CaptureChannelMap.isIdentity(map)).toBe(false)
    })

    it("monoFromChannel produces a single-channel map", () => {
        const map = CaptureChannelMap.monoFromChannel(3)
        expect(map).toHaveLength(1)
        expect(map[0]).toBe(3)
    })

    it("apply returns channels in the requested order", () => {
        const ch0 = channel(1, 2, 3)
        const ch1 = channel(10, 20, 30)
        const ch2 = channel(100, 200, 300)
        const map = [2, 0]
        const result = CaptureChannelMap.apply([ch0, ch1, ch2], map)
        expect(Array.from(result[0])).toEqual([100, 200, 300])
        expect(Array.from(result[1])).toEqual([1, 2, 3])
    })

    it("apply preserves channel order under identity mapping", () => {
        const ch0 = channel(1, 2)
        const ch1 = channel(3, 4)
        const result = CaptureChannelMap.apply([ch0, ch1], CaptureChannelMap.identity(2))
        expect(result[0]).toBe(ch0)
        expect(result[1]).toBe(ch1)
    })

    it("applyInPlace writes into the provided output buffers without allocating", () => {
        const ch0 = channel(1, 2, 3, 4)
        const ch1 = channel(10, 20, 30, 40)
        const out0 = new Float32Array(4)
        const out1 = new Float32Array(4)
        CaptureChannelMap.applyInPlace([ch0, ch1], [1, 0], [out0, out1])
        expect(Array.from(out0)).toEqual([10, 20, 30, 40])
        expect(Array.from(out1)).toEqual([1, 2, 3, 4])
    })

    it("validate rejects negative source indexes", () => {
        expect(() => CaptureChannelMap.validate([-1], 2)).toThrow()
    })

    it("validate rejects source indexes outside the channel count", () => {
        expect(() => CaptureChannelMap.validate([2], 2)).toThrow()
    })

    it("validate rejects empty maps", () => {
        expect(() => CaptureChannelMap.validate([], 2)).toThrow()
    })
})
