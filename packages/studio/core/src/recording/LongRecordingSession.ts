import {Arrays, int, isDefined, Notifier, Observer, Subscription, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {LongRecordingChunkBuffer} from "./LongRecordingChunkBuffer"
import {
    LongRecordingChunkEntry,
    LongRecordingManifest,
    LongRecordingSource,
    LongRecordingState
} from "./LongRecordingManifest"
import {LongRecordingOverview, OVERVIEW_DEFAULT_SAMPLES_PER_BIN} from "./LongRecordingOverview"
import {LongRecordingStorage} from "./LongRecordingStorage"

export interface LongRecordingProgress {
    readonly frames: int
    readonly chunks: int
    readonly bytes: int
    readonly elapsedSeconds: number
}

export type LongRecordingSessionState = "idle" | "armed" | "recording" | "stopping" | "stopped" | "failed"

export interface LongRecordingSessionConfig {
    readonly storage: LongRecordingStorage
    readonly sampleRate: int
    readonly numberOfChannels: int
    readonly framesPerChunk: int
    readonly source: LongRecordingSource
    readonly now?: () => int
    readonly overviewSamplesPerBin?: int
}

export class LongRecordingSession {
    readonly #storage: LongRecordingStorage
    readonly #sampleRate: int
    readonly #numberOfChannels: int
    readonly #framesPerChunk: int
    readonly #source: LongRecordingSource
    readonly #now: () => int
    readonly #buffer: LongRecordingChunkBuffer
    readonly #progressNotifier = new Notifier<LongRecordingProgress>()
    readonly #stateNotifier = new Notifier<LongRecordingSessionState>()
    readonly #storageErrorNotifier = new Notifier<unknown>()
    #manifest: LongRecordingManifest
    #sessionState: LongRecordingSessionState = "idle"
    #nextChunkIndex: int = 0
    #totalBytes: int = 0
    #writeQueue: Promise<void> = Promise.resolve()
    #lastStorageError: unknown = undefined

    readonly #overviewSamplesPerBin: int

    constructor(config: LongRecordingSessionConfig) {
        this.#storage = config.storage
        this.#sampleRate = config.sampleRate
        this.#numberOfChannels = config.numberOfChannels
        this.#framesPerChunk = config.framesPerChunk
        this.#source = config.source
        this.#now = config.now ?? (() => Date.now())
        this.#overviewSamplesPerBin = config.overviewSamplesPerBin ?? OVERVIEW_DEFAULT_SAMPLES_PER_BIN
        this.#buffer = new LongRecordingChunkBuffer(this.#numberOfChannels, this.#framesPerChunk)
        const overviewSpec = LongRecordingOverview.spec(this.#numberOfChannels, this.#overviewSamplesPerBin)
        this.#manifest = LongRecordingManifest.create({
            recordingId: this.#storage.recordingId,
            now: this.#now(),
            sampleRate: this.#sampleRate,
            numberOfChannels: this.#numberOfChannels,
            framesPerChunk: this.#framesPerChunk,
            source: this.#source,
            overview: {samplesPerBin: overviewSpec.samplesPerBin, bytesPerBin: overviewSpec.bytesPerBin}
        })
    }

    get recordingId(): UUID.String {return this.#storage.recordingId}

    get sessionState(): LongRecordingSessionState {return this.#sessionState}

    get manifest(): LongRecordingManifest {return this.#manifest}

    get lastStorageError(): unknown {return this.#lastStorageError}

    subscribeProgress(observer: Observer<LongRecordingProgress>): Subscription {
        return this.#progressNotifier.subscribe(observer)
    }

    subscribeState(observer: Observer<LongRecordingSessionState>): Subscription {
        return this.#stateNotifier.subscribe(observer)
    }

    subscribeStorageErrors(observer: Observer<unknown>): Subscription {
        return this.#storageErrorNotifier.subscribe(observer)
    }

    async arm(): Promise<void> {
        if (this.#sessionState !== "idle") {
            throw new Error(`cannot arm session in state '${this.#sessionState}'`)
        }
        await this.#persistManifest()
        this.#setSessionState("armed")
    }

    appendQuantum(channels: ReadonlyArray<Float32Array>): void {
        if (this.#sessionState !== "armed" && this.#sessionState !== "recording") {return}
        if (this.#sessionState === "armed") {this.#setSessionState("recording")}
        const flushed = this.#buffer.append(channels)
        if (flushed.length === 0) {return}
        for (const chunk of flushed) {
            const index = this.#nextChunkIndex++
            const entry: LongRecordingChunkEntry = {index, frames: chunk.frames, bytes: chunk.bytes.byteLength}
            const overviewBytes = this.#buildOverview(chunk.bytes, chunk.frames)
            this.#enqueueChunkWrite(entry, chunk.bytes, overviewBytes)
        }
    }

    #buildOverview(interleavedBytes: Uint8Array, frames: int): Uint8Array {
        const deinterleaved = LongRecordingChunkBuffer.deinterleave(
            interleavedBytes, this.#numberOfChannels, frames)
        return LongRecordingOverview.encodeChunkOverview(deinterleaved, this.#overviewSamplesPerBin)
    }

    async stop(): Promise<void> {
        const initial: LongRecordingSessionState = this.#sessionState
        if (initial === "stopped" || initial === "failed") {return}
        this.#setSessionState("stopping")
        const residual = this.#buffer.flushPartial()
        if (isDefined(residual)) {
            const index = this.#nextChunkIndex++
            const entry: LongRecordingChunkEntry = {
                index, frames: residual.frames, bytes: residual.bytes.byteLength
            }
            const overviewBytes = this.#buildOverview(residual.bytes, residual.frames)
            this.#enqueueChunkWrite(entry, residual.bytes, overviewBytes)
        }
        await this.#writeQueue
        const afterFlush: LongRecordingSessionState = this.#sessionState
        if (afterFlush === "failed") {return}
        this.#manifest = LongRecordingManifest.withState(this.#manifest, "stopped", this.#now())
        await this.#persistManifest()
        this.#setSessionState("stopped")
    }

    async fail(error: unknown): Promise<void> {
        if (this.#sessionState === "failed" || this.#sessionState === "stopped") {return}
        this.#lastStorageError = error
        this.#storageErrorNotifier.notify(error)
        this.#manifest = LongRecordingManifest.withState(this.#manifest, "failed", this.#now())
        const {status} = await Promises.tryCatch(this.#persistManifest())
        if (status === "rejected") {/* nothing else we can do */}
        this.#setSessionState("failed")
    }

    async abandon(): Promise<void> {
        if (this.#sessionState === "stopped" || this.#sessionState === "failed") {return}
        await this.#writeQueue
        this.#manifest = LongRecordingManifest.withState(this.#manifest, "abandoned", this.#now())
        await this.#persistManifest()
        this.#setSessionState("stopped")
    }

    #enqueueChunkWrite(entry: LongRecordingChunkEntry, data: Uint8Array, overviewBytes: Uint8Array): void {
        this.#writeQueue = this.#writeQueue.then(async () => {
            if (this.#sessionState === "failed") {return}
            const chunkResult = await Promises.tryCatch(this.#storage.writeChunk(entry.index, data))
            if (chunkResult.status === "rejected") {
                await this.fail(chunkResult.error)
                return
            }
            const overviewResult = await Promises.tryCatch(
                this.#storage.writeChunkOverview(entry.index, overviewBytes))
            if (overviewResult.status === "rejected") {
                this.#storageErrorNotifier.notify(overviewResult.error)
            }
            this.#manifest = LongRecordingManifest.withChunkAppended(this.#manifest, entry, this.#now())
            this.#totalBytes += entry.bytes
            const persistResult = await Promises.tryCatch(this.#persistManifest())
            if (persistResult.status === "rejected") {
                await this.fail(persistResult.error)
                return
            }
            this.#progressNotifier.notify({
                frames: this.#manifest.totalFrames,
                chunks: this.#manifest.chunks.length,
                bytes: this.#totalBytes,
                elapsedSeconds: this.#manifest.totalFrames / this.#sampleRate
            })
        })
    }

    async #persistManifest(): Promise<void> {
        await this.#storage.writeManifest(this.#manifest)
    }

    #setSessionState(state: LongRecordingSessionState): void {
        if (this.#sessionState === state) {return}
        this.#sessionState = state
        this.#stateNotifier.notify(state)
    }
}

export namespace LongRecordingSession {
    export const requestPersistence = async (): Promise<boolean> => {
        const storage = navigator.storage
        if (!isDefined(storage)) {return false}
        if (typeof storage.persisted === "function") {
            const already = await storage.persisted().catch(() => false)
            if (already) {return true}
        }
        if (typeof storage.persist === "function") {
            const result = await storage.persist().catch(() => false)
            return result
        }
        return false
    }

    export const assertOpfsSupported = (): void => {
        if (typeof navigator === "undefined"
            || !isDefined(navigator.storage)
            || typeof navigator.storage.getDirectory !== "function") {
            throw new Error("OPFS is not available in this browser; long recording cannot start")
        }
    }

    export interface LongRecordingHandle {
        readonly recordingId: UUID.String
        readonly state: LongRecordingState
        readonly chunkCount: int
        readonly totalFrames: int
    }

    export const enumerateExisting = async (
        opfs: import("@opendaw/lib-fusion").OpfsProtocol
    ): Promise<ReadonlyArray<LongRecordingHandle>> => {
        const ids = await LongRecordingStorage.listAll(opfs)
        if (ids.length === 0) {return Arrays.empty()}
        const handles: Array<LongRecordingHandle> = []
        for (const recordingId of ids) {
            const storage = LongRecordingStorage.create(recordingId, opfs)
            const manifestOption = await storage.readManifest()
            if (manifestOption.isEmpty()) {continue}
            const manifest = manifestOption.unwrap()
            handles.push({
                recordingId,
                state: manifest.state,
                chunkCount: manifest.chunks.length,
                totalFrames: manifest.totalFrames
            })
        }
        return handles
    }
}
