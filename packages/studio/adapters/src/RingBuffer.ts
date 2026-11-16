import {Arrays, assert, int, panic, Procedure} from "@opendaw/lib-std"

declare let document: unknown

export namespace RingBuffer {
    export interface Config {
        sab: SharedArrayBuffer
        numChunks: int
        numberOfChannels: int
        bufferSize: int
    }

    // Write cursor, read cursor, sticky dropped-frame count, then planar audio.
    export const HEADER_BYTES = 3 * Int32Array.BYTES_PER_ELEMENT
    export const droppedFrames = ({sab}: Config): int => Atomics.load(new Int32Array(sab, 0, 3), 2)

    export interface Writer {write(channels: ReadonlyArray<Float32Array>): void}

    export interface Reader {stop(): void}

    export const reader = ({
                               sab,
                               numChunks,
                               numberOfChannels,
                               bufferSize
                           }: Config, append: Procedure<Array<Float32Array>>, overflow: Procedure<int> = () => {}): Reader => {
        let running = true
        const pointers = new Int32Array(sab, 0, 3)
        const audio = new Float32Array(sab, HEADER_BYTES)
        const planarChunk = new Float32Array(numberOfChannels * bufferSize)
        const canBlock = typeof document === "undefined" // for usage in workers
        const step = () => {
            while (running) {
                const lost = Atomics.load(pointers, 2)
                if (lost !== 0) {
                    running = false
                    overflow(lost)
                    return
                }
                let readPtr = Atomics.load(pointers, 1)
                const writePtr = Atomics.load(pointers, 0)
                if (readPtr === writePtr) {
                    if (canBlock) {
                        Atomics.wait(pointers, 0, writePtr)
                        continue
                    }
                    setTimeout(step, 1)
                    return
                }
                while (readPtr !== writePtr) {
                    const offset = readPtr * numberOfChannels * bufferSize
                    planarChunk.set(audio.subarray(offset, offset + numberOfChannels * bufferSize))
                    const channels: Array<Float32Array> = []
                    for (let channel = 0; channel < numberOfChannels; channel++) {
                        const start = channel * bufferSize
                        channels.push(planarChunk.slice(start, start + bufferSize))
                    }
                    readPtr = (readPtr + 1) % numChunks
                    Atomics.store(pointers, 1, readPtr)
                    if (!running) {return}
                    append(channels)
                }
            }
        }
        step()
        return {stop: () => running = false}
    }

    export const writer = ({sab, numChunks, numberOfChannels, bufferSize}: Config): Writer => {
        const pointers = new Int32Array(sab, 0, 3)
        const audio = new Float32Array(sab, HEADER_BYTES)
        return Object.freeze({
            write: (channels: ReadonlyArray<Float32Array>): void => {
                if (channels.length !== numberOfChannels) {
                    // We ignore this. This can happen in the worklet setup phase.
                    return
                }
                for (const channel of channels) {
                    if (channel.length !== bufferSize) {
                        return panic("Each channel buffer must contain 'bufferSize' samples")
                    }
                }
                const writePtr = Atomics.load(pointers, 0)
                const next = (writePtr + 1) % numChunks
                if (Atomics.load(pointers, 2) !== 0) {return}
                if (next === Atomics.load(pointers, 1)) {
                    // Reserve one empty slot. A fault is sticky for this recording generation.
                    Atomics.store(pointers, 2, bufferSize)
                    Atomics.notify(pointers, 0)
                    return
                }
                const offset = writePtr * numberOfChannels * bufferSize
                channels.forEach((channel, index) => audio.set(channel, offset + index * bufferSize))
                Atomics.store(pointers, 0, next)
                Atomics.notify(pointers, 0)
            }
        })
    }
}

export const mergeChunkPlanes = (chunks: ReadonlyArray<ReadonlyArray<Float32Array>>,
                                 bufferSize: int,
                                 maxFrames: int = Number.MAX_SAFE_INTEGER): ReadonlyArray<Float32Array> => {
    if (chunks.length === 0) {return Arrays.empty()}
    const numChannels = chunks[0].length
    const numFrames = Math.min(bufferSize * chunks.length, maxFrames)
    return Arrays.create(channelIndex => {
        const outChannel = new Float32Array(numFrames)
        chunks.forEach((recordedChannels, chunkIndex) => {
            if (recordedChannels.length !== numChannels) {return panic()}
            const recordedChannel = recordedChannels[channelIndex]
            assert(recordedChannel.length === bufferSize, "Invalid length")
            const remaining = numFrames - chunkIndex * bufferSize
            assert(remaining > 0, "Invalid remaining")
            outChannel.set(remaining < bufferSize
                ? recordedChannel.slice(0, remaining)
                : recordedChannel, chunkIndex * bufferSize)
        })
        return outChannel
    }, numChannels)
}