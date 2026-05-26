import {ByteArrayInput, int, panic, Progress, SortedSet, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {DefaultSampleLoader} from "./DefaultSampleLoader"
import {SampleProvider} from "./SampleProvider"
import {SampleLoader, SampleLoaderManager, SampleMetaData} from "@opendaw/studio-adapters"
import {AudioData} from "@opendaw/lib-dsp"
import {SampleStorage} from "./SampleStorage"
import {OpfsProtocol, Peaks, SamplePeaks} from "@opendaw/lib-fusion"
import {Workers} from "../Workers"
import {Promises} from "@opendaw/lib-runtime"
import {LongRecordingManifest} from "../recording/LongRecordingManifest"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "../recording/LongRecordingMedia"
import {LongRecordingPeaksAdapter} from "../recording/LongRecordingPeaksAdapter"
import {LongRecordingRecovery, LongRecordingRecoveryReport} from "../recording/LongRecordingRecovery"
import {LongRecordingStorage} from "../recording/LongRecordingStorage"

type CachedSample = {
    uuid: UUID.Bytes
    data: AudioData
    peaks: Peaks
    meta: SampleMetaData
}

type RefCount = {
    uuid: UUID.Bytes
    count: int
}

type PendingLoad = {
    uuid: UUID.Bytes
    promise: Promise<void>
}

export interface GlobalSampleLoaderManagerOptions {
    readonly opfsProvider?: () => OpfsProtocol
}

/**
 * Read every chunk of a long recording and concatenate into a single `AudioData`. This is the
 * one-time materialization the product accepts at first play/export of a finalized recording. It
 * must NOT be called during record or stop/finalize.
 *
 * **Recovery guard.** Materialization is allowed only when the caller-supplied `recovery.overall`
 * is `"clean"`. For non-clean recordings (recoverable / corrupt / failed) the function rejects
 * via `panic`. Per-chunk write offsets use the **manifest's declared frame counts**, so a chunk
 * that decodes to fewer frames than declared cannot silently shift later chunks earlier or
 * zero-pad the tail. (The clean classification guarantees byte-level chunk consistency, so this is
 * also a defensive guard for unexpected mismatches.)
 */
export const materializeLongRecording = async (
    reference: LongRecordingMediaReference,
    access: LongRecordingMediaAccess,
    recovery: LongRecordingRecoveryReport
): Promise<AudioData> => {
    if (recovery.overall !== "clean") {
        return panic(`cannot materialize non-clean long recording (overall=${recovery.overall})`)
    }
    if (recovery.manifest.state !== "stopped") {
        return panic(`cannot materialize long recording in state ${recovery.manifest.state}`)
    }
    const {sampleRate, numberOfChannels, totalFrames} = reference
    const audio = AudioData.create(sampleRate, totalFrames, numberOfChannels)
    let writeOffset = 0
    for (const chunkEntry of recovery.manifest.chunks) {
        const expectedFrames = chunkEntry.frames
        const channels = await access.readChunkSamples(chunkEntry.index)
        const actualFrames = channels[0]?.length ?? 0
        if (actualFrames < expectedFrames) {
            return panic(
                `chunk ${chunkEntry.index} decoded to ${actualFrames} frames, expected ${expectedFrames}`)
        }
        for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex++) {
            const source = channels[channelIndex]
            const target = audio.frames[channelIndex]
            target.set(source.subarray(0, expectedFrames), writeOffset)
        }
        writeOffset += expectedFrames
    }
    if (writeOffset !== totalFrames) {
        return panic(`materialized ${writeOffset} frames; manifest declared ${totalFrames}`)
    }
    return audio
}

/**
 * Probe a long recording's manifest + chunks and classify recovery. Returns `Option.None` when
 * no manifest exists. Used by the manager fallback and `LongRecordingSampleLoader` to gate
 * `materializeLongRecording` calls.
 */
export const classifyLongRecording = async (
    storage: LongRecordingStorage
): Promise<{manifest: LongRecordingManifest, recovery: LongRecordingRecoveryReport} | undefined> => {
    const manifestOption = await storage.readManifest()
    if (manifestOption.isEmpty()) {return undefined}
    const manifest = manifestOption.unwrap()
    const probes = await storage.listChunkProbes()
    const recovery = LongRecordingRecovery.classify(manifest, probes)
    return {manifest, recovery}
}

export class GlobalSampleLoaderManager implements SampleLoaderManager, SampleProvider {
    readonly #provider: SampleProvider
    readonly #loaders: SortedSet<UUID.Bytes, SampleLoader>
    readonly #refCounts: SortedSet<UUID.Bytes, RefCount>
    readonly #cache: SortedSet<UUID.Bytes, CachedSample>
    readonly #pending: SortedSet<UUID.Bytes, PendingLoad>
    readonly #opfsProvider: (() => OpfsProtocol) | undefined

    constructor(provider: SampleProvider, options?: GlobalSampleLoaderManagerOptions) {
        this.#provider = provider
        this.#loaders = UUID.newSet(({uuid}) => uuid)
        this.#refCounts = UUID.newSet(({uuid}) => uuid)
        this.#cache = UUID.newSet(({uuid}) => uuid)
        this.#pending = UUID.newSet(({uuid}) => uuid)
        this.#opfsProvider = options?.opfsProvider
    }

    fetch(uuid: UUID.Bytes, progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> {
        return this.#provider.fetch(uuid, progress)
    }

    remove(uuid: UUID.Bytes): void {
        this.#refCounts.removeByKeyIfExist(uuid)
        this.#loaders.removeByKeyIfExist(uuid)
        this.#cache.removeByKeyIfExist(uuid)
        this.#pending.removeByKeyIfExist(uuid)
    }

    invalidate(uuid: UUID.Bytes): void {
        this.#cache.removeByKeyIfExist(uuid)
        this.#pending.removeByKeyIfExist(uuid)
        this.#loaders.opt(uuid).ifSome(loader => {
            loader.invalidate()
            if (loader instanceof DefaultSampleLoader) {
                this.#load(loader)
            }
        })
    }

    register(uuid: UUID.Bytes): Terminable {
        const current = this.#refCounts.opt(uuid)
        if (current.nonEmpty()) {
            current.unwrap().count++
        } else {
            this.#refCounts.add({uuid, count: 1})
        }
        return {
            terminate: () => {
                const ref = this.#refCounts.opt(uuid)
                if (ref.isEmpty()) {return}
                const {count} = ref.unwrap()
                if (count <= 1) {
                    this.#refCounts.removeByKey(uuid)
                    this.#loaders.removeByKeyIfExist(uuid)
                    this.#cache.removeByKeyIfExist(uuid)
                } else {
                    ref.unwrap().count--
                }
            }
        }
    }

    record(loader: SampleLoader): void {
        this.#loaders.add(loader)
    }

    getOrCreate(uuid: UUID.Bytes): SampleLoader {
        return this.#loaders.getOrCreate(uuid, uuid => {
            const loader = new DefaultSampleLoader(uuid)
            this.#load(loader)
            return loader
        })
    }

    async getAudioData(uuid: UUID.Bytes): Promise<AudioData> {
        const {promise, resolve, reject} = Promise.withResolvers<AudioData>()
        const loader = this.getOrCreate(uuid)
        let subscription: Subscription
        subscription = loader.subscribe(state => {
            if (state.type === "error") {
                queueMicrotask(() => subscription.terminate())
                reject(new Error(state.reason))
            } else if (loader.data.nonEmpty()) {
                queueMicrotask(() => subscription.terminate())
                resolve(loader.data.unwrap())
            }
        })
        return promise
    }

    #load(loader: DefaultSampleLoader): void {
        const {uuid} = loader
        const cached = this.#cache.opt(uuid)
        if (cached.nonEmpty()) {
            const {data, peaks, meta} = cached.unwrap()
            loader.setLoaded(data, peaks, meta)
            return
        }
        const pending = this.#pending.opt(uuid)
        if (pending.nonEmpty()) {
            pending.unwrap().promise.then(() => {
                const cached = this.#cache.opt(uuid)
                if (cached.nonEmpty()) {
                    const {data, peaks, meta} = cached.unwrap()
                    loader.setLoaded(data, peaks, meta)
                }
            })
            return
        }
        const promise = SampleStorage.get().load(uuid).then(
            ([data, peaks, meta]) => {
                this.#cache.add({uuid, data, peaks, meta})
                loader.setLoaded(data, peaks, meta)
            },
            async () => {
                const swapped = await this.#tryAttachLongRecording(loader)
                if (swapped) {return}
                return this.#fetchFromApi(loader)
            }
        ).catch((error: unknown) => {
            console.warn("Unexpected error loading sample:", error)
            loader.setError(error instanceof Error ? error.message : String(error))
        }).finally(() => this.#pending.removeByKeyIfExist(uuid))
        this.#pending.add({uuid, promise})
    }

    async #tryAttachLongRecording(loader: DefaultSampleLoader): Promise<boolean> {
        const provider = this.#opfsProvider
        if (provider === undefined) {return false}
        const {uuid} = loader
        const opfs = provider()
        const recordingId = UUID.toString(uuid)
        const storage = LongRecordingStorage.create(recordingId, opfs)
        const classified = await classifyLongRecording(storage)
        if (classified === undefined) {return false}
        const {manifest, recovery} = classified
        if (recovery.overall !== "clean" || manifest.state !== "stopped") {
            // Surface the non-clean classification explicitly. The dashboard "Recoverable
            // Recordings" panel exposes the same recovery info for inspection/discard. Refusing
            // here prevents the renderer/engine from playing back silently zero-padded audio for
            // a recording that the user must triage explicitly.
            loader.setError(
                `long recording ${recordingId.slice(0, 8)} is `
                + `${recovery.overall}/${manifest.state}; cannot load for playback`)
            return true
        }
        const reference = LongRecordingMediaReference.fromManifest(manifest)
        const access = LongRecordingMediaAccess.create(reference, storage)
        const bins = await access.readOverviewBins()
        const peaks = LongRecordingPeaksAdapter.fromOverview({
            bins,
            numberOfChannels: reference.numberOfChannels,
            samplesPerBin: reference.overviewSamplesPerBin,
            totalFrames: reference.totalFrames
        })
        const audio = await materializeLongRecording(reference, access, recovery)
        const meta: SampleMetaData = {
            name: `Long Recording ${recordingId.slice(0, 8)}`,
            bpm: 120,
            duration: reference.durationSeconds,
            sample_rate: reference.sampleRate,
            origin: "recording"
        }
        this.#cache.add({uuid, data: audio, peaks, meta})
        loader.setLoaded(audio, peaks, meta)
        return true
    }

    async #fetchFromApi(loader: DefaultSampleLoader): Promise<void> {
        const {uuid} = loader
        const [fetchProgress, peakProgress] = Progress.split(
            progress => loader.setProgress(0.1 + 0.9 * progress), 2
        )
        const fetchResult = await Promises.tryCatch(this.#provider.fetch(uuid, fetchProgress))
        if (fetchResult.status === "rejected") {
            const error = fetchResult.error
            console.warn(error)
            loader.setError(error instanceof Error ? error.message : String(error))
            return
        }
        const [audio, meta] = fetchResult.value
        const shifts = SamplePeaks.findBestFit(audio.numberOfFrames)
        const peaksBuffer = await Workers.Peak.generateAsync(
            peakProgress, shifts, audio.frames, audio.numberOfFrames, audio.numberOfChannels
        ) as ArrayBuffer
        const storeResult = await Promises.tryCatch(SampleStorage.get().save({uuid, audio, peaks: peaksBuffer, meta}))
        if (storeResult.status === "resolved") {
            const peaks = SamplePeaks.from(new ByteArrayInput(peaksBuffer))
            this.#cache.add({uuid, data: audio, peaks, meta})
            loader.setLoaded(audio, peaks, meta)
        } else {
            const error = storeResult.error
            console.warn(error)
            loader.setError(error instanceof Error ? error.message : String(error))
        }
    }
}