import {isDefined, Terminator} from "@opendaw/lib-std"
import {CaptureSource, CaptureSourceMetadata} from "./CaptureSourceTypes"

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

    constructor(options: WrappingCaptureSourceOptions) {
        this.#metadata = options.metadata
        this.#outputNode = options.outputNode
        const onTerminate = options.onTerminate
        if (isDefined(onTerminate)) {
            this.#terminator.own({terminate: onTerminate})
        }
    }

    get metadata(): CaptureSourceMetadata {return this.#metadata}

    get outputNode(): AudioNode {return this.#outputNode}

    terminate(): void {this.#terminator.terminate()}
}
