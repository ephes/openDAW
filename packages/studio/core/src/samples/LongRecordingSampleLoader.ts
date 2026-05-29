import {Notifier, Observer, Option, panic, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {Peaks} from "@opendaw/lib-fusion"
import {AudioData} from "@opendaw/lib-dsp"
import {SampleLoader, SampleLoaderState, SampleMetaData} from "@opendaw/studio-adapters"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "../recording/LongRecordingMedia"
import {LongRecordingPeaksAdapter} from "../recording/LongRecordingPeaksAdapter"
import {LongRecordingStorage} from "../recording/LongRecordingStorage"
import {classifyLongRecording, materializeLongRecording} from "./GlobalSampleLoaderManager"

export interface LongRecordingSampleLoaderConfig {
    readonly uuid: UUID.Bytes
    readonly reference: LongRecordingMediaReference
    readonly access: LongRecordingMediaAccess
    /**
     * Used to classify recovery (manifest + chunk probes) before materializing PCM. Required so
     * the loader can refuse non-clean recordings instead of silently producing zero-padded or
     * misaligned audio.
     */
    readonly storage: LongRecordingStorage
}

/**
 * Direct, typed wrapper around a long-recording artifact that implements `SampleLoader`. Used by
 * the browser harness, the dashboard recovery probe, and tests that need a long-recording-aware
 * loader without going through `GlobalSampleLoaderManager`.
 *
 * Contract:
 *   - `peaks` resolves immediately at construction time from the persisted overview bins (no chunk
 *     PCM read).
 *   - `data` is `None` and `state` is `"progress"` until the first `subscribe()` *that observes a
 *     transition* or an explicit `materializeAudioData()` call. Once materialization completes,
 *     `state` becomes `"loaded"` and `data` is `Some`, matching every other openDAW `SampleLoader`
 *     ("loaded implies data").
 *   - If the recording is not classified as `recovery.overall === "clean"` and
 *     `manifest.state === "stopped"`, `state` transitions to `"error"` with the classification as
 *     the reason. No partial PCM is produced.
 */
export class LongRecordingSampleLoader implements SampleLoader {
    static readonly create = async (config: LongRecordingSampleLoaderConfig): Promise<LongRecordingSampleLoader> => {
        const {uuid, reference, access, storage} = config
        const bins = await access.readOverviewBins()
        const peaks = LongRecordingPeaksAdapter.fromOverview({
            bins,
            numberOfChannels: reference.numberOfChannels,
            samplesPerBin: reference.overviewSamplesPerBin,
            totalFrames: reference.totalFrames
        })
        return new LongRecordingSampleLoader(uuid, reference, access, storage, peaks)
    }

    readonly #uuid: UUID.Bytes
    readonly #reference: LongRecordingMediaReference
    readonly #access: LongRecordingMediaAccess
    readonly #storage: LongRecordingStorage
    readonly #peaks: Option<Peaks>
    readonly #meta: Option<SampleMetaData>
    readonly #notifier: Notifier<SampleLoaderState>

    #data: Option<AudioData> = Option.None
    #state: SampleLoaderState = {type: "progress", progress: 0.0}
    #materializePromise: Option<Promise<AudioData>> = Option.None

    private constructor(uuid: UUID.Bytes,
                        reference: LongRecordingMediaReference,
                        access: LongRecordingMediaAccess,
                        storage: LongRecordingStorage,
                        peaks: Peaks) {
        this.#uuid = uuid
        this.#reference = reference
        this.#access = access
        this.#storage = storage
        this.#peaks = Option.wrap(peaks)
        this.#notifier = new Notifier<SampleLoaderState>()
        this.#meta = Option.wrap({
            name: `Long Recording ${reference.recordingId}`,
            bpm: 120,
            duration: reference.durationSeconds,
            sample_rate: reference.sampleRate,
            origin: "recording"
        })
    }

    get uuid(): UUID.Bytes {return this.#uuid}
    get reference(): LongRecordingMediaReference {return this.#reference}
    get data(): Option<AudioData> {return this.#data}
    get peaks(): Option<Peaks> {return this.#peaks}
    get meta(): Option<SampleMetaData> {return this.#meta}
    get state(): SampleLoaderState {return this.#state}

    subscribe(observer: Observer<SampleLoaderState>): Subscription {
        if (this.#state.type === "loaded" || this.#state.type === "error") {
            observer(this.#state)
            return Terminable.Empty
        }
        // First real subscriber kicks off materialization so the consumer can wait for "loaded".
        // Subsequent subscribers latch onto the same promise.
        if (this.#materializePromise.isEmpty()) {
            const promise = this.#materialize()
            // The promise rejection (non-clean recording) is observable via the notifier as
            // state="error". Swallow the bare-promise rejection so background subscribers don't
            // trigger an unhandled-rejection warning. Callers that explicitly await
            // materializeAudioData() still see the rejection via that promise.
            promise.catch(() => undefined)
            this.#materializePromise = Option.wrap(promise)
        }
        return this.#notifier.subscribe(observer)
    }

    invalidate(): void {
        this.#data = Option.None
        this.#materializePromise = Option.None
        this.#state = {type: "progress", progress: 0.0}
        this.#notifier.notify(this.#state)
    }

    /**
     * Force materialization of the chunked PCM into a single `AudioData`. Inspection-only
     * callers (dashboard panel, the harness's standalone probe) typically do **not** call this —
     * they only read `peaks`. The engine fetchAudio path triggers materialization via subscribe()
     * instead.
     */
    async materializeAudioData(): Promise<AudioData> {
        if (this.#data.nonEmpty()) {return this.#data.unwrap()}
        if (this.#materializePromise.nonEmpty()) {return this.#materializePromise.unwrap()}
        const promise = this.#materialize()
        this.#materializePromise = Option.wrap(promise)
        return promise
    }

    async #materialize(): Promise<AudioData> {
        const classified = await classifyLongRecording(this.#storage)
        if (classified.isEmpty()) {
            const reason = `long recording ${this.#reference.recordingId} has no manifest`
            this.#state = {type: "error", reason}
            this.#notifier.notify(this.#state)
            return panic(reason)
        }
        const {manifest, recovery} = classified.unwrap()
        if (recovery.overall !== "clean" || manifest.state !== "stopped") {
            const reason = `long recording ${this.#reference.recordingId} is `
                + `${recovery.overall}/${manifest.state}; cannot load for playback`
            this.#state = {type: "error", reason}
            this.#notifier.notify(this.#state)
            return panic(reason)
        }
        const audio = await materializeLongRecording(this.#reference, this.#access, recovery)
        this.#data = Option.wrap(audio)
        this.#state = {type: "loaded"}
        this.#notifier.notify(this.#state)
        return audio
    }

    toString(): string {return `{LongRecordingSampleLoader ${UUID.toString(this.#uuid)}}`}
}
