import {describe, expect, it} from "vitest"
import {LongRecordingChunkBuffer} from "./LongRecordingChunkBuffer"

const channel = (...values: number[]): Float32Array => Float32Array.from(values)

describe("LongRecordingChunkBuffer", () => {
    it("does not flush until a full chunk is accumulated", () => {
        const buffer = new LongRecordingChunkBuffer(1, 4)
        const flushed = buffer.append([channel(1, 2)])
        expect(flushed).toHaveLength(0)
        expect(buffer.framesFilled).toBe(2)
    })

    it("emits a single chunk when the input exactly fills it", () => {
        const buffer = new LongRecordingChunkBuffer(1, 4)
        const flushed = buffer.append([channel(1, 2, 3, 4)])
        expect(flushed).toHaveLength(1)
        expect(flushed[0].frames).toBe(4)
        const decoded = LongRecordingChunkBuffer.deinterleave(flushed[0].bytes, 1, flushed[0].frames)
        expect(Array.from(decoded[0])).toEqual([1, 2, 3, 4])
    })

    it("splits large inputs into multiple chunks", () => {
        const buffer = new LongRecordingChunkBuffer(1, 2)
        const flushed = buffer.append([channel(1, 2, 3, 4, 5)])
        expect(flushed).toHaveLength(2)
        expect(flushed.map(chunk => chunk.frames)).toEqual([2, 2])
        expect(buffer.framesFilled).toBe(1)
        const decoded0 = LongRecordingChunkBuffer.deinterleave(flushed[0].bytes, 1, flushed[0].frames)
        const decoded1 = LongRecordingChunkBuffer.deinterleave(flushed[1].bytes, 1, flushed[1].frames)
        expect(Array.from(decoded0[0])).toEqual([1, 2])
        expect(Array.from(decoded1[0])).toEqual([3, 4])
    })

    it("interleaves multi-channel input correctly", () => {
        const buffer = new LongRecordingChunkBuffer(2, 3)
        const flushed = buffer.append([channel(1, 2, 3), channel(10, 20, 30)])
        expect(flushed).toHaveLength(1)
        const view = new Float32Array(flushed[0].bytes.buffer, flushed[0].bytes.byteOffset, 6)
        expect(Array.from(view)).toEqual([1, 10, 2, 20, 3, 30])
        const decoded = LongRecordingChunkBuffer.deinterleave(flushed[0].bytes, 2, flushed[0].frames)
        expect(Array.from(decoded[0])).toEqual([1, 2, 3])
        expect(Array.from(decoded[1])).toEqual([10, 20, 30])
    })

    it("flushPartial returns the residual chunk and resets", () => {
        const buffer = new LongRecordingChunkBuffer(1, 4)
        buffer.append([channel(1, 2)])
        const residual = buffer.flushPartial()
        expect(residual).toBeDefined()
        expect(residual!.frames).toBe(2)
        const decoded = LongRecordingChunkBuffer.deinterleave(residual!.bytes, 1, residual!.frames)
        expect(Array.from(decoded[0])).toEqual([1, 2])
        expect(buffer.framesFilled).toBe(0)
        expect(buffer.flushPartial()).toBeUndefined()
    })

    it("never reuses the emitted buffer", () => {
        const buffer = new LongRecordingChunkBuffer(1, 2)
        const flushed = buffer.append([channel(1, 2)])
        const initialBytes = Array.from(flushed[0].bytes)
        buffer.append([channel(99, 99)])
        expect(Array.from(flushed[0].bytes)).toEqual(initialBytes)
    })
})
