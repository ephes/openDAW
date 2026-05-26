import {Notifier, Observer, Subscription, Terminator} from "@opendaw/lib-std"
import {CaptureAudio} from "../capture/CaptureAudio"
import {CaptureChannelMap} from "./CaptureChannelMap"
import {CaptureContinuityReport, CaptureSource, CaptureSourceMetadata} from "./CaptureSourceTypes"

export interface CaptureAudioBridgeOptions {
    readonly capture: CaptureAudio
    readonly outputNode: AudioNode
    readonly requestedChannels: number
    readonly contextSampleRate: number
    readonly channelMap?: CaptureChannelMap
}

export class CaptureAudioBridgeSource implements CaptureSource {
    readonly #terminator = new Terminator()
    readonly #outputNode: AudioNode
    readonly #metadata: CaptureSourceMetadata
    readonly #continuityNotifier = new Notifier<CaptureContinuityReport>()
    readonly #errorNotifier = new Notifier<unknown>()

    constructor(options: CaptureAudioBridgeOptions) {
        const {capture, outputNode, requestedChannels, contextSampleRate, channelMap} = options
        const track = capture.streamMediaTrack.unwrapOrNull()
        const trackSettings = track?.getSettings() ?? {}
        const actualChannels = channelMap?.length ?? capture.effectiveChannelCount
        const sourceLabel = capture.deviceLabel.unwrapOrNull() ?? capture.label
        this.#metadata = {
            kind: "getUserMedia",
            label: sourceLabel,
            deviceId: trackSettings.deviceId,
            deviceLabel: track?.label,
            requestedSampleRate: contextSampleRate,
            requestedChannels,
            actualSampleRate: trackSettings.sampleRate ?? contextSampleRate,
            actualChannels,
            autoGainControl: trackSettings.autoGainControl,
            echoCancellation: trackSettings.echoCancellation,
            noiseSuppression: trackSettings.noiseSuppression
        }
        this.#outputNode = outputNode
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
