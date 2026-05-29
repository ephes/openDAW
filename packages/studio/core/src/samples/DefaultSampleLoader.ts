import {Notifier, Observer, Option, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {Peaks} from "@opendaw/lib-fusion"
import {SampleLoader, SampleLoaderState, SampleMetaData} from "@opendaw/studio-adapters"
import {AudioData} from "@opendaw/lib-dsp"

export class DefaultSampleLoader implements SampleLoader {
    readonly #uuid: UUID.Bytes
    readonly #notifier: Notifier<SampleLoaderState>

    #meta: Option<SampleMetaData> = Option.None
    #data: Option<AudioData> = Option.None
    #peaks: Option<Peaks> = Option.None
    #state: SampleLoaderState = {type: "progress", progress: 0.0}
    #deferredAudio: Option<() => Promise<AudioData>> = Option.None
    #materializing: boolean = false
    #dataRequested: boolean = false

    constructor(uuid: UUID.Bytes) {
        this.#uuid = uuid
        this.#notifier = new Notifier<SampleLoaderState>()
    }

    subscribe(observer: Observer<SampleLoaderState>): Subscription {
        if (this.#state.type === "loaded" || this.#state.type === "error") {
            observer(this.#state)
            return Terminable.Empty
        }
        return this.#notifier.subscribe(observer)
    }

    requestData(): void {
        this.#dataRequested = true
        this.#maybeMaterialize()
    }

    get uuid(): UUID.Bytes {return this.#uuid}
    get data(): Option<AudioData> {return this.#data}
    get meta(): Option<SampleMetaData> {return this.#meta}
    get peaks(): Option<Peaks> {return this.#peaks}
    get state(): SampleLoaderState {return this.#state}

    setLoaded(data: AudioData, peaks: Peaks, meta: SampleMetaData): void {
        this.#data = Option.wrap(data)
        this.#peaks = Option.wrap(peaks)
        this.#meta = Option.wrap(meta)
        this.#deferredAudio = Option.None
        this.#state = {type: "loaded"}
        this.#notifier.notify(this.#state)
    }

    /**
     * Make peaks available immediately while deferring the (potentially large) `AudioData`
     * materialization until a consumer explicitly calls `requestData()` (playback / export). A consumer
     * that only reads `peaks` or subscribes for repaint never triggers it. Used by the long-recording
     * fallback so browsing a project with a multi-hour recording does not pull the whole take into
     * memory just to paint its waveform.
     */
    setPeaksReady(peaks: Peaks, meta: SampleMetaData, provideAudio: () => Promise<AudioData>): void {
        this.#peaks = Option.wrap(peaks)
        this.#meta = Option.wrap(meta)
        this.#deferredAudio = Option.wrap(provideAudio)
        this.#state = {type: "progress", progress: 1.0}
        this.#notifier.notify(this.#state)
        this.#maybeMaterialize()
    }

    #maybeMaterialize(): void {
        if (!this.#dataRequested || this.#deferredAudio.isEmpty()
            || this.#materializing || this.#data.nonEmpty()) {return}
        this.#materializing = true
        this.#deferredAudio.unwrap()().then(audio => {
            this.#data = Option.wrap(audio)
            this.#state = {type: "loaded"}
            this.#notifier.notify(this.#state)
        }, (error: unknown) => {
            this.#state = {type: "error", reason: error instanceof Error ? error.message : String(error)}
            this.#notifier.notify(this.#state)
        }).finally(() => {this.#materializing = false})
    }

    setProgress(progress: number): void {
        this.#state = {type: "progress", progress}
        this.#notifier.notify(this.#state)
    }

    setError(reason: string): void {
        this.#state = {type: "error", reason}
        this.#notifier.notify(this.#state)
    }

    invalidate(): void {
        this.#state = {type: "progress", progress: 0.0}
        this.#meta = Option.None
        this.#data = Option.None
        this.#peaks = Option.None
        this.#deferredAudio = Option.None
        this.#materializing = false
        this.#dataRequested = false
        this.#notifier.notify(this.#state)
    }

    toString(): string {return `{DefaultSampleLoader ${UUID.toString(this.#uuid)}}`}
}
