import {assert, Float16, int, panic} from "@opendaw/lib-std"
import {Peaks} from "@opendaw/lib-fusion"
import {LongRecordingOverviewBin} from "./LongRecordingOverview"

export interface LongRecordingPeaksInput {
    readonly bins: ReadonlyArray<LongRecordingOverviewBin>
    readonly numberOfChannels: int
    readonly samplesPerBin: int
    readonly totalFrames: int
}

export namespace LongRecordingPeaksAdapter {
    export const fromOverview = (input: LongRecordingPeaksInput): Peaks => {
        const {bins, numberOfChannels, samplesPerBin, totalFrames} = input
        assert(numberOfChannels > 0, "numberOfChannels must be > 0")
        if (!isPowerOfTwo(samplesPerBin)) {
            return panic(`samplesPerBin (${samplesPerBin}) must be a positive power of two`)
        }
        if (bins.length === 0 || totalFrames === 0) {
            const data: ReadonlyArray<Int32Array> = Array.from(
                {length: numberOfChannels}, () => new Int32Array(0))
            return new OverviewPeaks([], data, 0, numberOfChannels)
        }
        const shift = Math.log2(samplesPerBin)
        assert(bins.length % numberOfChannels === 0,
            `overview bin count (${bins.length}) not divisible by numberOfChannels (${numberOfChannels})`)
        const numPeaks = bins.length / numberOfChannels
        const data: Int32Array[] = Array.from({length: numberOfChannels}, () => new Int32Array(numPeaks))
        for (let binIndex = 0; binIndex < numPeaks; binIndex++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const flatIndex = binIndex * numberOfChannels + channel
                const value = bins[flatIndex]
                assert(value.channel === channel,
                    `overview bin at flatIndex ${flatIndex} reports channel ${value.channel}, expected ${channel}`)
                data[channel][binIndex] = packMinMax(value.min, value.max)
            }
        }
        const stages: ReadonlyArray<Peaks.Stage> = [new Peaks.Stage(shift, numPeaks, 0)]
        return new OverviewPeaks(stages, data, totalFrames, numberOfChannels)
    }

    const isPowerOfTwo = (value: int): boolean =>
        value > 0 && (value & (value - 1)) === 0

    const packMinMax = (min: number, max: number): int => {
        const minBits = Float16.floatToIntBits(min) & 0xffff
        const maxBits = Float16.floatToIntBits(max) & 0xffff
        return minBits | (maxBits << 16)
    }
}

class OverviewPeaks implements Peaks {
    constructor(readonly stages: ReadonlyArray<Peaks.Stage>,
                readonly data: ReadonlyArray<Int32Array>,
                readonly numFrames: int,
                readonly numChannels: int) {}

    nearest(unitsPerPixel: number): Peaks.Stage | null {
        if (this.stages.length === 0) {return null}
        const shift = Math.floor(Math.log(Math.abs(unitsPerPixel)) / Math.LN2)
        let index = this.stages.length
        while (--index > -1) {
            if (shift >= this.stages[index].shift) {return this.stages[index]}
        }
        return this.stages[0]
    }

    toString(): string {return `{LongRecordingOverviewPeaks num-peaks: ${this.stages[0]?.numPeaks ?? 0}}`}
}
