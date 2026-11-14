import {ByteArrayInput, int, isDefined, Optional, Progress, SortedSet, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {DefaultSampleLoader} from "./DefaultSampleLoader"
import {SampleProvider} from "./SampleProvider"
import {SampleLoader, SampleLoaderManager, SampleMetaData} from "@opendaw/studio-adapters"
import {AudioData} from "@opendaw/lib-dsp"
import {SampleStorage} from "./SampleStorage"
import {Peaks, SamplePeaks} from "@opendaw/lib-fusion"
import {Workers} from "../Workers"
import {Promises} from "@opendaw/lib-runtime"

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
    loaders: Set<DefaultSampleLoader>
}

export class GlobalSampleLoaderManager implements SampleLoaderManager, SampleProvider {
    readonly #provider: SampleProvider
    readonly #loaders: SortedSet<UUID.Bytes, SampleLoader>
    readonly #refCounts: SortedSet<UUID.Bytes, RefCount>
    readonly #cache: SortedSet<UUID.Bytes, CachedSample>
    readonly #pending: SortedSet<UUID.Bytes, PendingLoad>

    constructor(provider: SampleProvider) {
        this.#provider = provider
        this.#loaders = UUID.newSet(({uuid}) => uuid)
        this.#refCounts = UUID.newSet(({uuid}) => uuid)
        this.#cache = UUID.newSet(({uuid}) => uuid)
        this.#pending = UUID.newSet(({uuid}) => uuid)
    }

    fetch(uuid: UUID.Bytes, progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> {
        return this.#provider.fetch(uuid, progress)
    }

    remove(uuid: UUID.Bytes): void {
        this.#refCounts.removeByKeyIfExist(uuid)
        const pending = this.#pending.opt(uuid)
        this.#pending.removeByKeyIfExist(uuid)
        const loader = this.#loaders.removeByKeyIfExist(uuid)
        this.#cache.removeByKeyIfExist(uuid)
        if (loader instanceof DefaultSampleLoader) {loader.setError("Sample load retired")}
        pending.ifSome(attempt => attempt.loaders.forEach(joined => {
            if (joined !== loader) {joined.setError("Sample load retired")}
        }))
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
        const ref = this.#refCounts.getOrCreate(uuid, uuid => ({uuid, count: 0}))
        ref.count++
        let released = false
        return {
            terminate: () => {
                if (released) {return}
                released = true
                if (!this.#refCounts.opt(uuid).contains(ref)) {return}
                if (ref.count <= 1) {
                    this.remove(uuid)
                } else {
                    ref.count--
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
        const subscription: Subscription = loader.subscribe(state => {
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
            pending.unwrap().loaders.add(loader)
            return
        }
        const attempt: PendingLoad = {uuid, loaders: new Set([loader])}
        this.#pending.add(attempt)
        this.#read(attempt).then(cached => {
            if (!this.#isCurrent(attempt) || !isDefined(cached)) {return}
            this.#cache.add(cached)
            const {data, peaks, meta} = cached
            attempt.loaders.forEach(loader => loader.setLoaded(data, peaks, meta))
        }, (error: unknown) => {
            if (!this.#isCurrent(attempt)) {return}
            console.warn("Unexpected error loading sample:", error)
            attempt.loaders.forEach(loader => loader.setError(error instanceof Error ? error.message : String(error)))
        }).finally(() => {
            if (this.#isCurrent(attempt)) {this.#pending.removeByKey(uuid)}
        })
    }

    #isCurrent(attempt: PendingLoad): boolean {
        return this.#pending.opt(attempt.uuid).contains(attempt)
    }

    async #read(attempt: PendingLoad): Promise<Optional<CachedSample>> {
        const {uuid} = attempt
        const stored = await Promises.tryCatch(SampleStorage.get().load(uuid))
        if (!this.#isCurrent(attempt)) {return undefined}
        if (stored.status === "resolved") {
            const [data, peaks, meta] = stored.value
            return {uuid, data, peaks, meta}
        }
        const [fetchProgress, peakProgress] = Progress.split(
            progress => {
                if (this.#isCurrent(attempt)) {
                    attempt.loaders.forEach(loader => loader.setProgress(0.1 + 0.9 * progress))
                }
            }, 2
        )
        const [audio, meta] = await this.#provider.fetch(uuid, fetchProgress)
        if (!this.#isCurrent(attempt)) {return undefined}
        const shifts = SamplePeaks.findBestFit(audio.numberOfFrames)
        const peaksBuffer = await Workers.Peak.generateAsync(
            peakProgress, shifts, audio.frames, audio.numberOfFrames, audio.numberOfChannels
        ) as ArrayBuffer
        if (!this.#isCurrent(attempt)) {return undefined}
        await SampleStorage.get().save({uuid, audio, peaks: peaksBuffer, meta})
        if (!this.#isCurrent(attempt)) {return undefined}
        const peaks = SamplePeaks.from(new ByteArrayInput(peaksBuffer))
        return {uuid, data: audio, peaks, meta}
    }
}
