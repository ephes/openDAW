import {describe, expect, it} from "vitest"
import {AudioData} from "./audio-data"

describe("AudioData planar allocation", () => {
    it.each([1, 2, 5])("isolates %s shared planes", channels => {
        const data = AudioData.create(32000, 7, channels)
        expect(data.sampleRate).toBe(32000)
        expect(data.numberOfFrames).toBe(7)
        expect(data.numberOfChannels).toBe(channels)
        expect(data.frames).toHaveLength(channels)
        const buffer = data.frames[0].buffer
        expect(buffer).toBeInstanceOf(SharedArrayBuffer)
        expect(buffer.byteLength).toBe(channels * 7 * 4)
        data.frames.forEach((plane, index) => {
            expect(plane.buffer).toBe(buffer)
            expect(plane.byteOffset).toBe(index * 7 * 4)
            expect(plane.length).toBe(7)
            plane[0] = index + 1
            plane[6] = -(index + 1)
        })
        data.frames.forEach((plane, index) => expect(Array.from(plane)).toEqual([index + 1, 0, 0, 0, 0, 0, -(index + 1)]))
        data.frames[0].fill(99)
        data.frames.slice(1).forEach((plane, index) => expect(plane[0]).toBe(index + 2))
    })
    it("supports coherent zero-frame planes", () => {
        const data = AudioData.create(48000, 0, 3)
        expect(data.numberOfFrames).toBe(0)
        expect(data.frames).toHaveLength(3)
        data.frames.forEach(plane => {
            expect(plane.length).toBe(0)
            expect(plane.buffer).toBe(data.frames[0].buffer)
            expect(plane.buffer.byteLength).toBe(0)
        })
    })
})
