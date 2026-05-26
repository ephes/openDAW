import {int, isDefined, Option, tryCatch, UUID} from "@opendaw/lib-std"

export const LONG_RECORDING_SCHEMA_VERSION = 1 as const

export type LongRecordingState = "active" | "stopped" | "abandoned" | "failed"

export type LongRecordingSourceKind = "getUserMedia" | "synthetic" | "test"

export interface LongRecordingSource {
    kind: LongRecordingSourceKind
    label: string
    requestedSampleRate: int
    requestedChannels: int
    actualSampleRate: int
    actualChannels: int
}

export interface LongRecordingChunkEntry {
    index: int
    frames: int
    bytes: int
}

export interface LongRecordingManifest {
    schema: typeof LONG_RECORDING_SCHEMA_VERSION
    recordingId: UUID.String
    createdAt: int
    updatedAt: int
    state: LongRecordingState
    sampleRate: int
    numberOfChannels: int
    framesPerChunk: int
    bytesPerSample: int
    chunks: ReadonlyArray<LongRecordingChunkEntry>
    totalFrames: int
    source: LongRecordingSource
}

export namespace LongRecordingManifest {
    export const CHUNK_FILE_NAME_PAD = 6

    export const chunkFileName = (index: int): string =>
        `${String(index).padStart(CHUNK_FILE_NAME_PAD, "0")}.pcm`

    export const expectedChunkBytes = (frames: int, channels: int, bytesPerSample: int): int =>
        frames * channels * bytesPerSample

    export const create = (params: {
        recordingId: UUID.String
        now: int
        sampleRate: int
        numberOfChannels: int
        framesPerChunk: int
        bytesPerSample?: int
        source: LongRecordingSource
    }): LongRecordingManifest => ({
        schema: LONG_RECORDING_SCHEMA_VERSION,
        recordingId: params.recordingId,
        createdAt: params.now,
        updatedAt: params.now,
        state: "active",
        sampleRate: params.sampleRate,
        numberOfChannels: params.numberOfChannels,
        framesPerChunk: params.framesPerChunk,
        bytesPerSample: params.bytesPerSample ?? Float32Array.BYTES_PER_ELEMENT,
        chunks: [],
        totalFrames: 0,
        source: params.source
    })

    export const withChunkAppended = (
        manifest: LongRecordingManifest,
        chunk: LongRecordingChunkEntry,
        now: int
    ): LongRecordingManifest => ({
        ...manifest,
        chunks: [...manifest.chunks, chunk],
        totalFrames: manifest.totalFrames + chunk.frames,
        updatedAt: now
    })

    export const withState = (
        manifest: LongRecordingManifest,
        state: LongRecordingState,
        now: int
    ): LongRecordingManifest => ({...manifest, state, updatedAt: now})

    export const encode = (manifest: LongRecordingManifest): Uint8Array =>
        new TextEncoder().encode(JSON.stringify(manifest))

    export const decode = (bytes: Uint8Array): Option<LongRecordingManifest> => {
        const decoded = tryCatch(() => JSON.parse(new TextDecoder().decode(bytes)) as unknown)
        if (decoded.status === "failure") {return Option.None}
        return validate(decoded.value)
    }

    export const validate = (value: unknown): Option<LongRecordingManifest> => {
        if (!isPlainRecord(value)) {return Option.None}
        const schema = value["schema"]
        if (schema !== LONG_RECORDING_SCHEMA_VERSION) {return Option.None}
        const recordingId = value["recordingId"]
        if (typeof recordingId !== "string" || !UUID.validateString(recordingId)) {return Option.None}
        const createdAt = value["createdAt"]
        const updatedAt = value["updatedAt"]
        if (!isFiniteInt(createdAt) || !isFiniteInt(updatedAt)) {return Option.None}
        const state = value["state"]
        if (!isLongRecordingState(state)) {return Option.None}
        const sampleRate = value["sampleRate"]
        const numberOfChannels = value["numberOfChannels"]
        const framesPerChunk = value["framesPerChunk"]
        const bytesPerSample = value["bytesPerSample"]
        const totalFrames = value["totalFrames"]
        if (!isPositiveOrZeroInt(sampleRate)
            || !isPositiveOrZeroInt(numberOfChannels)
            || !isPositiveOrZeroInt(framesPerChunk)
            || !isPositiveOrZeroInt(bytesPerSample)
            || !isPositiveOrZeroInt(totalFrames)) {
            return Option.None
        }
        const rawChunks = value["chunks"]
        if (!Array.isArray(rawChunks)) {return Option.None}
        const chunks: Array<LongRecordingChunkEntry> = []
        for (const entry of rawChunks) {
            const parsed = validateChunkEntry(entry)
            if (parsed.isEmpty()) {return Option.None}
            chunks.push(parsed.unwrap())
        }
        const source = validateSource(value["source"])
        if (source.isEmpty()) {return Option.None}
        return Option.wrap<LongRecordingManifest>({
            schema: LONG_RECORDING_SCHEMA_VERSION,
            recordingId,
            createdAt,
            updatedAt,
            state,
            sampleRate,
            numberOfChannels,
            framesPerChunk,
            bytesPerSample,
            totalFrames,
            chunks,
            source: source.unwrap()
        })
    }

    const validateChunkEntry = (value: unknown): Option<LongRecordingChunkEntry> => {
        if (!isPlainRecord(value)) {return Option.None}
        const index = value["index"]
        const frames = value["frames"]
        const bytes = value["bytes"]
        if (!isPositiveOrZeroInt(index) || !isPositiveOrZeroInt(frames) || !isPositiveOrZeroInt(bytes)) {
            return Option.None
        }
        return Option.wrap({index, frames, bytes})
    }

    const validateSource = (value: unknown): Option<LongRecordingSource> => {
        if (!isPlainRecord(value)) {return Option.None}
        const kind = value["kind"]
        if (kind !== "getUserMedia" && kind !== "synthetic" && kind !== "test") {return Option.None}
        const label = value["label"]
        if (typeof label !== "string") {return Option.None}
        const requestedSampleRate = value["requestedSampleRate"]
        const requestedChannels = value["requestedChannels"]
        const actualSampleRate = value["actualSampleRate"]
        const actualChannels = value["actualChannels"]
        if (!isPositiveOrZeroInt(requestedSampleRate)
            || !isPositiveOrZeroInt(requestedChannels)
            || !isPositiveOrZeroInt(actualSampleRate)
            || !isPositiveOrZeroInt(actualChannels)) {
            return Option.None
        }
        return Option.wrap({kind, label, requestedSampleRate, requestedChannels, actualSampleRate, actualChannels})
    }

    const isLongRecordingState = (value: unknown): value is LongRecordingState =>
        value === "active" || value === "stopped" || value === "abandoned" || value === "failed"

    const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
        isDefined(value) && typeof value === "object" && !Array.isArray(value)

    const isFiniteInt = (value: unknown): value is int =>
        typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)

    const isPositiveOrZeroInt = (value: unknown): value is int =>
        isFiniteInt(value) && value >= 0
}
