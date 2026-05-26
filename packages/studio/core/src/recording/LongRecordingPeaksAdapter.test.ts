import {describe, expect, it} from "vitest"
import {Float16} from "@opendaw/lib-std"
import {Peaks} from "@opendaw/lib-fusion"
import {LongRecordingOverviewBin} from "./LongRecordingOverview"
import {LongRecordingPeaksAdapter} from "./LongRecordingPeaksAdapter"

const bin = (channel: number, min: number, max: number): LongRecordingOverviewBin => ({channel, min, max})

const unpackMin = (value: number): number => Peaks.unpack(value, 0)
const unpackMax = (value: number): number => Peaks.unpack(value, 1)

describe("LongRecordingPeaksAdapter", () => {
    it("returns an empty Peaks when no bins are provided", () => {
        const peaks = LongRecordingPeaksAdapter.fromOverview({
            bins: [],
            numberOfChannels: 1,
            samplesPerBin: 256,
            totalFrames: 0
        })
        expect(peaks.numChannels).toBe(1)
        expect(peaks.numFrames).toBe(0)
        expect(peaks.stages.length).toBe(0)
        expect(peaks.data.length).toBe(1)
        expect(peaks.data[0].length).toBe(0)
        expect(peaks.nearest(1)).toBeNull()
    })

    it("builds a single-stage mono peaks instance whose bins round-trip through Float16", () => {
        const bins: ReadonlyArray<LongRecordingOverviewBin> = [
            bin(0, -0.25, 0.5),
            bin(0, -0.75, 0.125),
            bin(0, 0.0, 0.0),
            bin(0, -1.0, 1.0)
        ]
        const peaks = LongRecordingPeaksAdapter.fromOverview({
            bins,
            numberOfChannels: 1,
            samplesPerBin: 256,
            totalFrames: 4 * 256
        })
        expect(peaks.numChannels).toBe(1)
        expect(peaks.numFrames).toBe(1024)
        expect(peaks.stages.length).toBe(1)
        const stage = peaks.stages[0]
        expect(stage.shift).toBe(8)
        expect(stage.numPeaks).toBe(4)
        expect(stage.dataOffset).toBe(0)
        const data = peaks.data[0]
        expect(data.length).toBe(4)
        for (let index = 0; index < 4; index++) {
            const expectedMin = Float16.intBitsToFloat(Float16.floatToIntBits(bins[index].min))
            const expectedMax = Float16.intBitsToFloat(Float16.floatToIntBits(bins[index].max))
            expect(unpackMin(data[index])).toBeCloseTo(expectedMin, 3)
            expect(unpackMax(data[index])).toBeCloseTo(expectedMax, 3)
        }
    })

    it("separates stereo channels into independent data arrays preserving channel order", () => {
        const bins: ReadonlyArray<LongRecordingOverviewBin> = [
            bin(0, -0.1, 0.1), bin(1, -0.9, 0.9),
            bin(0, -0.2, 0.2), bin(1, -0.8, 0.8)
        ]
        const peaks = LongRecordingPeaksAdapter.fromOverview({
            bins,
            numberOfChannels: 2,
            samplesPerBin: 128,
            totalFrames: 2 * 128
        })
        expect(peaks.numChannels).toBe(2)
        expect(peaks.numFrames).toBe(256)
        expect(peaks.stages.length).toBe(1)
        expect(peaks.stages[0].shift).toBe(7)
        expect(peaks.stages[0].numPeaks).toBe(2)
        const left = peaks.data[0]
        const right = peaks.data[1]
        expect(left.length).toBe(2)
        expect(right.length).toBe(2)
        expect(unpackMin(left[0])).toBeCloseTo(-0.1, 3)
        expect(unpackMax(left[0])).toBeCloseTo(0.1, 3)
        expect(unpackMin(right[0])).toBeCloseTo(-0.9, 3)
        expect(unpackMax(right[0])).toBeCloseTo(0.9, 3)
        expect(unpackMin(left[1])).toBeCloseTo(-0.2, 3)
        expect(unpackMax(right[1])).toBeCloseTo(0.8, 3)
    })

    it("nearest() returns the only stage for any unitsPerPixel when there is one stage", () => {
        const peaks = LongRecordingPeaksAdapter.fromOverview({
            bins: [bin(0, -1, 1), bin(0, -1, 1)],
            numberOfChannels: 1,
            samplesPerBin: 256,
            totalFrames: 512
        })
        const stage = peaks.nearest(1)
        expect(stage).not.toBeNull()
        expect(stage!.shift).toBe(8)
        const stage2 = peaks.nearest(1024)
        expect(stage2!.shift).toBe(8)
    })

    it("rejects samplesPerBin values that are not a positive power of two", () => {
        expect(() =>
            LongRecordingPeaksAdapter.fromOverview({
                bins: [bin(0, 0, 0)],
                numberOfChannels: 1,
                samplesPerBin: 200,
                totalFrames: 200
            })
        ).toThrow(/power of two/)
        expect(() =>
            LongRecordingPeaksAdapter.fromOverview({
                bins: [bin(0, 0, 0)],
                numberOfChannels: 1,
                samplesPerBin: 0,
                totalFrames: 0
            })
        ).toThrow(/power of two/)
    })
})
