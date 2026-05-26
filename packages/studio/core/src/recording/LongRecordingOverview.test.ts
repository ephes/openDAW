import {describe, expect, it} from "vitest"
import {LongRecordingOverview} from "./LongRecordingOverview"

const channel = (...values: number[]): Float32Array => Float32Array.from(values)

describe("LongRecordingOverview", () => {
    it("spec() exposes bytes-per-bin = 4 × numberOfChannels", () => {
        expect(LongRecordingOverview.spec(1, 256).bytesPerBin).toBe(4)
        expect(LongRecordingOverview.spec(2, 256).bytesPerBin).toBe(8)
    })

    it("computes one bin per samplesPerBin frames, with the tail bin holding the remainder", () => {
        expect(LongRecordingOverview.expectedBinsForFrames(1024, 256)).toBe(4)
        expect(LongRecordingOverview.expectedBinsForFrames(1000, 256)).toBe(4)
        expect(LongRecordingOverview.expectedBinsForFrames(1, 256)).toBe(1)
    })

    it("formats overview file names with zero-padded indexes", () => {
        expect(LongRecordingOverview.overviewFileName(0)).toBe("000000.overview")
        expect(LongRecordingOverview.overviewFileName(42)).toBe("000042.overview")
    })

    it("round-trips mono peaks within Float16 precision", () => {
        const data = channel(0.5, -0.5, 0.25, -0.25, 0.75, -0.75, 0.1, -0.1)
        const bytes = LongRecordingOverview.encodeChunkOverview([data], 4)
        const bins = LongRecordingOverview.decodeChunkOverview(bytes, 1)
        expect(bins).toHaveLength(2)
        expect(bins[0].channel).toBe(0)
        expect(bins[0].min).toBeCloseTo(-0.5, 2)
        expect(bins[0].max).toBeCloseTo(0.5, 2)
        expect(bins[1].min).toBeCloseTo(-0.75, 2)
        expect(bins[1].max).toBeCloseTo(0.75, 2)
    })

    it("preserves channel order during encode/decode", () => {
        const left = channel(0.9, 0.8, 0.7, 0.6)
        const right = channel(-0.9, -0.8, -0.7, -0.6)
        const bytes = LongRecordingOverview.encodeChunkOverview([left, right], 4)
        const bins = LongRecordingOverview.decodeChunkOverview(bytes, 2)
        expect(bins).toHaveLength(2)
        expect(bins[0].channel).toBe(0)
        expect(bins[0].min).toBeCloseTo(0.6, 2)
        expect(bins[0].max).toBeCloseTo(0.9, 2)
        expect(bins[1].channel).toBe(1)
        expect(bins[1].min).toBeCloseTo(-0.9, 2)
        expect(bins[1].max).toBeCloseTo(-0.6, 2)
    })

    it("encodes the partial trailing bin without padding the output", () => {
        const data = channel(0.5, 0.5, 0.5)
        const bytes = LongRecordingOverview.encodeChunkOverview([data], 4)
        const spec = LongRecordingOverview.spec(1, 4)
        expect(bytes.byteLength).toBe(spec.bytesPerBin)
        const bins = LongRecordingOverview.decodeChunkOverview(bytes, 1)
        expect(bins).toHaveLength(1)
        expect(bins[0].min).toBeCloseTo(0.5, 2)
        expect(bins[0].max).toBeCloseTo(0.5, 2)
    })

    it("recognizes overview files by their suffix", () => {
        expect(LongRecordingOverview.isOverviewFileName("000000.overview")).toBe(true)
        expect(LongRecordingOverview.isOverviewFileName("000000.pcm")).toBe(false)
    })
})
