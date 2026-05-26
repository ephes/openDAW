import {Notifier, Observer, Subscription, Terminator} from "@opendaw/lib-std"
import {CaptureContinuityReport, CaptureSource, CaptureSourceMetadata} from "./CaptureSourceTypes"

export interface WrappingCaptureSourceOptions {
    readonly metadata: CaptureSourceMetadata
    readonly outputNode: AudioNode
    readonly onTerminate?: () => void
}

/**
 * `CaptureSource` adapter for callers that already own an `AudioNode` carrying the recorded signal
 * (for example, openDAW's `CaptureAudio` `recordGainNode`). Reusing this avoids opening a second
 * `getUserMedia` stream when the existing capture chain can be reused.
 */
export class WrappingCaptureSource implements CaptureSource {
    readonly #terminator = new Terminator()
    readonly #metadata: CaptureSourceMetadata
    readonly #outputNode: AudioNode
    readonly #continuityNotifier = new Notifier<CaptureContinuityReport>()
    readonly #errorNotifier = new Notifier<unknown>()

    constructor(options: WrappingCaptureSourceOptions) {
        this.#metadata = options.metadata
        this.#outputNode = options.outputNode
        const onTerminate = options.onTerminate
        if (onTerminate !== undefined) {
            this.#terminator.own({terminate: onTerminate})
        }
    }

    get metadata(): CaptureSourceMetadata {return this.#metadata}

    get outputNode(): AudioNode {return this.#outputNode}

    subscribeContinuity(observer: Observer<CaptureContinuityReport>): Subscription {
        return this.#continuityNotifier.subscribe(observer)
    }

    subscribeErrors(observer: Observer<unknown>): Subscription {
        return this.#errorNotifier.subscribe(observer)
    }

    terminate(): void {this.#terminator.terminate()}
}
