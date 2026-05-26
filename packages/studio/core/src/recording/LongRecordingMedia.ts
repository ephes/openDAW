import {assert, int, Option, UUID} from "@opendaw/lib-std"
import {LongRecordingChunkBuffer} from "./LongRecordingChunkBuffer"
import {LongRecordingManifest} from "./LongRecordingManifest"
import {LongRecordingOverview, LongRecordingOverviewBin} from "./LongRecordingOverview"
import {LongRecordingStorage} from "./LongRecordingStorage"

export interface LongRecordingMediaReference {
    readonly kind: "long-recording"
    readonly recordingId: UUID.String
    readonly sampleRate: int
    readonly numberOfChannels: int
    readonly durationSeconds: number
    readonly totalFrames: int
    readonly framesPerChunk: int
    readonly overviewSamplesPerBin: int
    readonly state: LongRecordingManifest["state"]
}

export namespace LongRecordingMediaReference {
    export const fromManifest = (manifest: LongRecordingManifest): LongRecordingMediaReference => ({
        kind: "long-recording",
        recordingId: manifest.recordingId,
        sampleRate: manifest.sampleRate,
        numberOfChannels: manifest.numberOfChannels,
        durationSeconds: manifest.totalFrames / Math.max(1, manifest.sampleRate),
        totalFrames: manifest.totalFrames,
        framesPerChunk: manifest.framesPerChunk,
        overviewSamplesPerBin: manifest.overview.samplesPerBin,
        state: manifest.state
    })

    export const load = async (
        recordingId: UUID.String,
        opfs: import("@opendaw/lib-fusion").OpfsProtocol
    ): Promise<Option<LongRecordingMediaReference>> => {
        const storage = LongRecordingStorage.create(recordingId, opfs)
        const manifest = await storage.readManifest()
        return manifest.map(value => fromManifest(value))
    }
}

export interface ChunkLocation {
    readonly chunkIndex: int
    readonly chunkFrameOffset: int
}

export interface LongRecordingMediaAccess {
    readonly reference: LongRecordingMediaReference

    locateFrame(frameIndex: int): ChunkLocation

    locateSeconds(seconds: number): ChunkLocation

    readChunkSamples(chunkIndex: int): Promise<ReadonlyArray<Float32Array>>

    readOverviewBins(): Promise<ReadonlyArray<LongRecordingOverviewBin>>
}

export namespace LongRecordingMediaAccess {
    export const create = (
        reference: LongRecordingMediaReference,
        storage: LongRecordingStorage
    ): LongRecordingMediaAccess => new OpfsLongRecordingMediaAccess(reference, storage)
}

class OpfsLongRecordingMediaAccess implements LongRecordingMediaAccess {
    readonly reference: LongRecordingMediaReference
    readonly #storage: LongRecordingStorage

    constructor(reference: LongRecordingMediaReference, storage: LongRecordingStorage) {
        this.reference = reference
        this.#storage = storage
    }

    locateFrame(frameIndex: int): ChunkLocation {
        assert(frameIndex >= 0, "frameIndex must be >= 0")
        const chunkIndex = Math.floor(frameIndex / this.reference.framesPerChunk)
        const chunkFrameOffset = frameIndex - chunkIndex * this.reference.framesPerChunk
        return {chunkIndex, chunkFrameOffset}
    }

    locateSeconds(seconds: number): ChunkLocation {
        const frameIndex = Math.floor(seconds * this.reference.sampleRate)
        return this.locateFrame(frameIndex)
    }

    async readChunkSamples(chunkIndex: int): Promise<ReadonlyArray<Float32Array>> {
        const bytes = await this.#storage.readChunk(chunkIndex)
        const frames = bytes.byteLength
            / (this.reference.numberOfChannels * Float32Array.BYTES_PER_ELEMENT)
        return LongRecordingChunkBuffer.deinterleave(bytes, this.reference.numberOfChannels, frames)
    }

    async readOverviewBins(): Promise<ReadonlyArray<LongRecordingOverviewBin>> {
        const bins: Array<LongRecordingOverviewBin> = []
        const manifestOpt = await this.#storage.readManifest()
        if (manifestOpt.isEmpty()) {return bins}
        const manifest = manifestOpt.unwrap()
        for (const chunk of manifest.chunks) {
            const overviewOpt = await this.#storage.readChunkOverview(chunk.index)
            if (overviewOpt.isEmpty()) {continue}
            const chunkBins = LongRecordingOverview.decodeChunkOverview(
                overviewOpt.unwrap(), manifest.numberOfChannels)
            for (const bin of chunkBins) {bins.push(bin)}
        }
        return bins
    }
}
