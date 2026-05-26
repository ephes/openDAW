import {Arrays, int, Option, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {LongRecordingManifest} from "./LongRecordingManifest"
import {ChunkProbe, LongRecordingRecovery} from "./LongRecordingRecovery"

export interface LongRecordingStorage {
    readonly recordingId: UUID.String
    readonly rootPath: string

    writeManifest(manifest: LongRecordingManifest): Promise<void>

    readManifest(): Promise<Option<LongRecordingManifest>>

    writeChunk(index: int, data: Uint8Array): Promise<void>

    readChunk(index: int): Promise<Uint8Array>

    listChunkProbes(): Promise<ReadonlyArray<ChunkProbe>>

    delete(): Promise<void>
}

export namespace LongRecordingStorage {
    export const ROOT = "recordings/v1"
    export const MANIFEST_NAME = "manifest.json"
    export const CHUNKS_DIR = "chunks"

    export const dirFor = (recordingId: UUID.String): string => `${ROOT}/${recordingId}`

    export const create = (recordingId: UUID.String, opfs: OpfsProtocol): LongRecordingStorage =>
        new OpfsLongRecordingStorage(recordingId, opfs)

    export const listAll = async (opfs: OpfsProtocol): Promise<ReadonlyArray<UUID.String>> => {
        const entries = await opfs.list(ROOT)
        return entries
            .filter(entry => entry.kind === "directory" && UUID.validateString(entry.name))
            .map(entry => UUID.asString(entry.name))
    }
}

class OpfsLongRecordingStorage implements LongRecordingStorage {
    readonly recordingId: UUID.String
    readonly rootPath: string
    readonly #opfs: OpfsProtocol
    readonly #chunksDir: string

    constructor(recordingId: UUID.String, opfs: OpfsProtocol) {
        this.recordingId = recordingId
        this.rootPath = LongRecordingStorage.dirFor(recordingId)
        this.#opfs = opfs
        this.#chunksDir = `${this.rootPath}/${LongRecordingStorage.CHUNKS_DIR}`
    }

    async writeManifest(manifest: LongRecordingManifest): Promise<void> {
        const bytes = LongRecordingManifest.encode(manifest)
        await this.#opfs.write(`${this.rootPath}/${LongRecordingStorage.MANIFEST_NAME}`, bytes)
    }

    async readManifest(): Promise<Option<LongRecordingManifest>> {
        const path = `${this.rootPath}/${LongRecordingStorage.MANIFEST_NAME}`
        const {status, value} = await Promises.tryCatch(this.#opfs.read(path))
        if (status === "rejected") {return Option.None}
        return LongRecordingManifest.decode(value)
    }

    async writeChunk(index: int, data: Uint8Array): Promise<void> {
        await this.#opfs.write(`${this.#chunksDir}/${LongRecordingManifest.chunkFileName(index)}`, data)
    }

    async readChunk(index: int): Promise<Uint8Array> {
        return this.#opfs.read(`${this.#chunksDir}/${LongRecordingManifest.chunkFileName(index)}`)
    }

    async listChunkProbes(): Promise<ReadonlyArray<ChunkProbe>> {
        const entries = await this.#opfs.list(this.#chunksDir).catch(() => Arrays.empty<OpfsProtocol.Entry>())
        const probes: Array<ChunkProbe> = []
        for (const entry of entries) {
            if (entry.kind !== "file") {continue}
            const index = LongRecordingRecovery.parseChunkIndex(entry.name)
            if (index === undefined) {continue}
            const size = await this.#opfs.size(`${this.#chunksDir}/${entry.name}`).catch(() => -1)
            if (size < 0) {continue}
            probes.push({index, bytes: size})
        }
        probes.sort((left, right) => left.index - right.index)
        return probes
    }

    async delete(): Promise<void> {
        await this.#opfs.delete(this.rootPath)
    }
}
