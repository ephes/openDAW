import {assert, int} from "@opendaw/lib-std"

export interface FlushedChunk {
    readonly bytes: Uint8Array
    readonly frames: int
}

export class LongRecordingChunkBuffer {
    readonly #numberOfChannels: int
    readonly #framesPerChunk: int
    #buffer: Float32Array
    #framesFilled: int

    constructor(numberOfChannels: int, framesPerChunk: int) {
        assert(numberOfChannels > 0, "numberOfChannels must be > 0")
        assert(framesPerChunk > 0, "framesPerChunk must be > 0")
        this.#numberOfChannels = numberOfChannels
        this.#framesPerChunk = framesPerChunk
        this.#buffer = new Float32Array(numberOfChannels * framesPerChunk)
        this.#framesFilled = 0
    }

    get numberOfChannels(): int {return this.#numberOfChannels}

    get framesPerChunk(): int {return this.#framesPerChunk}

    get framesFilled(): int {return this.#framesFilled}

    append(channels: ReadonlyArray<Float32Array>): ReadonlyArray<FlushedChunk> {
        assert(channels.length === this.#numberOfChannels,
            `channel count mismatch: expected ${this.#numberOfChannels}, got ${channels.length}`)
        const flushed: Array<FlushedChunk> = []
        let inputOffset = 0
        const inputFrames = channels[0].length
        for (let channelIndex = 1; channelIndex < channels.length; channelIndex++) {
            assert(channels[channelIndex].length === inputFrames,
                "channel buffers must have the same length")
        }
        while (inputOffset < inputFrames) {
            const framesToCopy = Math.min(this.#framesPerChunk - this.#framesFilled, inputFrames - inputOffset)
            this.#interleaveInto(channels, inputOffset, framesToCopy)
            this.#framesFilled += framesToCopy
            inputOffset += framesToCopy
            if (this.#framesFilled === this.#framesPerChunk) {
                flushed.push(this.#emitFullChunk())
            }
        }
        return flushed
    }

    flushPartial(): FlushedChunk | undefined {
        if (this.#framesFilled === 0) {return undefined}
        const usedSamples = this.#framesFilled * this.#numberOfChannels
        const bytes = new Uint8Array(this.#buffer.buffer.slice(0, usedSamples * Float32Array.BYTES_PER_ELEMENT))
        const frames = this.#framesFilled
        this.#framesFilled = 0
        this.#buffer = new Float32Array(this.#numberOfChannels * this.#framesPerChunk)
        return {bytes, frames}
    }

    #emitFullChunk(): FlushedChunk {
        const bytes = new Uint8Array(this.#buffer.buffer.slice(0, this.#buffer.byteLength))
        this.#framesFilled = 0
        this.#buffer = new Float32Array(this.#numberOfChannels * this.#framesPerChunk)
        return {bytes, frames: this.#framesPerChunk}
    }

    #interleaveInto(channels: ReadonlyArray<Float32Array>, inputOffset: int, framesToCopy: int): void {
        const numberOfChannels = this.#numberOfChannels
        const writeBase = this.#framesFilled * numberOfChannels
        for (let frame = 0; frame < framesToCopy; frame++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                this.#buffer[writeBase + frame * numberOfChannels + channel] = channels[channel][inputOffset + frame]
            }
        }
    }
}

export namespace LongRecordingChunkBuffer {
    export const deinterleave = (bytes: Uint8Array, numberOfChannels: int, frames: int): ReadonlyArray<Float32Array> => {
        assert(bytes.byteLength >= frames * numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
            "byte buffer too small for requested frames")
        const view = new Float32Array(bytes.buffer, bytes.byteOffset, frames * numberOfChannels)
        const out: Array<Float32Array> = []
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const channelData = new Float32Array(frames)
            for (let frame = 0; frame < frames; frame++) {
                channelData[frame] = view[frame * numberOfChannels + channel]
            }
            out.push(channelData)
        }
        return out
    }
}
