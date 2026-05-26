import {assert, Float16, int} from "@opendaw/lib-std"

export const OVERVIEW_FILE_SUFFIX = ".overview"
export const OVERVIEW_DEFAULT_SAMPLES_PER_BIN = 256

export interface LongRecordingOverviewBin {
    readonly channel: int
    readonly min: number
    readonly max: number
}

export interface LongRecordingOverviewSpec {
    readonly samplesPerBin: int
    readonly numberOfChannels: int
    readonly bytesPerBin: int
}

export namespace LongRecordingOverview {
    const BIN_BYTES_PER_CHANNEL = 4

    export const spec = (numberOfChannels: int,
                         samplesPerBin: int = OVERVIEW_DEFAULT_SAMPLES_PER_BIN): LongRecordingOverviewSpec => ({
        samplesPerBin,
        numberOfChannels,
        bytesPerBin: numberOfChannels * BIN_BYTES_PER_CHANNEL
    })

    export const overviewFileName = (chunkIndex: int): string =>
        `${String(chunkIndex).padStart(6, "0")}${OVERVIEW_FILE_SUFFIX}`

    export const isOverviewFileName = (name: string): boolean => name.endsWith(OVERVIEW_FILE_SUFFIX)

    export const expectedBinsForFrames = (frames: int, samplesPerBin: int): int =>
        Math.ceil(frames / samplesPerBin)

    export const encodeChunkOverview = (
        channels: ReadonlyArray<Float32Array>,
        samplesPerBin: int
    ): Uint8Array => {
        assert(channels.length > 0, "must provide at least one channel")
        const frames = channels[0].length
        const bins = expectedBinsForFrames(frames, samplesPerBin)
        const numberOfChannels = channels.length
        const buffer = new Uint8Array(bins * numberOfChannels * BIN_BYTES_PER_CHANNEL)
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        for (let binIndex = 0; binIndex < bins; binIndex++) {
            const start = binIndex * samplesPerBin
            const end = Math.min(start + samplesPerBin, frames)
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const data = channels[channel]
                let min = Number.POSITIVE_INFINITY
                let max = Number.NEGATIVE_INFINITY
                for (let frame = start; frame < end; frame++) {
                    const value = data[frame]
                    if (value < min) {min = value}
                    if (value > max) {max = value}
                }
                if (!Number.isFinite(min)) {min = 0}
                if (!Number.isFinite(max)) {max = 0}
                const offset = binIndex * numberOfChannels * BIN_BYTES_PER_CHANNEL + channel * BIN_BYTES_PER_CHANNEL
                view.setInt16(offset, Float16.floatToIntBits(min), true)
                view.setInt16(offset + 2, Float16.floatToIntBits(max), true)
            }
        }
        return buffer
    }

    export const decodeChunkOverview = (
        bytes: Uint8Array,
        numberOfChannels: int
    ): ReadonlyArray<LongRecordingOverviewBin> => {
        const bytesPerBin = numberOfChannels * BIN_BYTES_PER_CHANNEL
        assert(bytes.byteLength % bytesPerBin === 0,
            `overview byte length (${bytes.byteLength}) not divisible by bytesPerBin (${bytesPerBin})`)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const bins: Array<LongRecordingOverviewBin> = []
        const binCount = bytes.byteLength / bytesPerBin
        for (let binIndex = 0; binIndex < binCount; binIndex++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const offset = binIndex * bytesPerBin + channel * BIN_BYTES_PER_CHANNEL
                const minBits = view.getInt16(offset, true)
                const maxBits = view.getInt16(offset + 2, true)
                bins.push({
                    channel,
                    min: Float16.intBitsToFloat(minBits & 0xffff),
                    max: Float16.intBitsToFloat(maxBits & 0xffff)
                })
            }
        }
        return bins
    }
}
