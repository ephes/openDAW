import {Observer, Option, Subscription, UUID} from "@opendaw/lib-std"
import {Peaks} from "@opendaw/lib-fusion"
import {SampleLoaderState} from "./SampleLoaderState"
import {AudioData} from "@opendaw/lib-dsp"

export interface SampleLoader {
    get data(): Option<AudioData>
    get peaks(): Option<Peaks>
    get uuid(): UUID.Bytes
    get state(): SampleLoaderState
    invalidate(): void
    subscribe(observer: Observer<SampleLoaderState>): Subscription
    /**
     * Signal that a consumer actually needs the decoded `AudioData` (playback / export), as opposed to
     * merely observing state for a repaint. Eager loaders already have (or are fetching) their data, so
     * this is a no-op for them; lazy loaders (e.g. long recordings) use it as the trigger to materialize
     * PCM on demand. Subscribing alone must NOT materialize, because timeline adapters subscribe purely
     * to dispatch repaint/change events.
     */
    requestData(): void
}