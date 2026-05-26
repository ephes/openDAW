import {int, isDefined, Notifier, Observer, Subscription, Terminator} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {CaptureChannelMap} from "./CaptureChannelMap"
import {CaptureContinuityReport, CaptureSource, CaptureSourceMetadata} from "./CaptureSourceTypes"

export interface GetUserMediaCaptureSourceOptions {
    readonly context: AudioContext
    readonly requestedChannels: int
    readonly deviceId?: string
    readonly echoCancellation?: boolean
    readonly noiseSuppression?: boolean
    readonly autoGainControl?: boolean
    readonly channelMap?: CaptureChannelMap
}

export class GetUserMediaCaptureSource implements CaptureSource {
    readonly #terminator = new Terminator()
    readonly #stream: MediaStream
    readonly #metadata: CaptureSourceMetadata
    readonly #outputNode: AudioNode
    readonly #continuityNotifier = new Notifier<CaptureContinuityReport>()
    readonly #errorNotifier = new Notifier<unknown>()

    private constructor(stream: MediaStream, metadata: CaptureSourceMetadata, outputNode: AudioNode) {
        this.#stream = stream
        this.#metadata = metadata
        this.#outputNode = outputNode
        this.#terminator.own({
            terminate: () => {
                stream.getAudioTracks().forEach(track => track.stop())
            }
        })
    }

    static async open(options: GetUserMediaCaptureSourceOptions): Promise<GetUserMediaCaptureSource> {
        const {context, requestedChannels, deviceId} = options
        const constraints: MediaTrackConstraints = {
            echoCancellation: options.echoCancellation ?? false,
            noiseSuppression: options.noiseSuppression ?? false,
            autoGainControl: options.autoGainControl ?? false,
            channelCount: {ideal: requestedChannels},
            deviceId: isDefined(deviceId) ? {exact: deviceId} : undefined
        }
        const {status, value: stream, error} =
            await Promises.tryCatch(navigator.mediaDevices.getUserMedia({audio: constraints}))
        if (status === "rejected") {throw error}
        const track = stream.getAudioTracks().at(0)
        const trackSettings = track?.getSettings() ?? {}
        const actualChannels = (trackSettings.channelCount ?? requestedChannels)
        const actualSampleRate = trackSettings.sampleRate ?? context.sampleRate
        const sourceNode = context.createMediaStreamSource(stream)
        const channelMap = options.channelMap ?? CaptureChannelMap.identity(actualChannels)
        CaptureChannelMap.validate(channelMap, actualChannels)
        const outputNode = CaptureChannelMap.isIdentity(channelMap) && channelMap.length === actualChannels
            ? sourceNode
            : routeThroughMap(context, sourceNode, actualChannels, channelMap)
        const metadata: CaptureSourceMetadata = {
            kind: "getUserMedia",
            label: track?.label ?? "default",
            deviceId: trackSettings.deviceId,
            deviceLabel: track?.label,
            requestedSampleRate: context.sampleRate,
            requestedChannels,
            actualSampleRate,
            actualChannels: channelMap.length,
            autoGainControl: trackSettings.autoGainControl,
            echoCancellation: trackSettings.echoCancellation,
            noiseSuppression: trackSettings.noiseSuppression
        }
        return new GetUserMediaCaptureSource(stream, metadata, outputNode)
    }

    get metadata(): CaptureSourceMetadata {return this.#metadata}

    get outputNode(): AudioNode {return this.#outputNode}

    get mediaStream(): MediaStream {return this.#stream}

    subscribeContinuity(observer: Observer<CaptureContinuityReport>): Subscription {
        return this.#continuityNotifier.subscribe(observer)
    }

    subscribeErrors(observer: Observer<unknown>): Subscription {
        return this.#errorNotifier.subscribe(observer)
    }

    terminate(): void {this.#terminator.terminate()}
}

const routeThroughMap = (
    context: AudioContext,
    sourceNode: AudioNode,
    sourceChannels: int,
    channelMap: CaptureChannelMap
): AudioNode => {
    const splitter = context.createChannelSplitter(sourceChannels)
    sourceNode.connect(splitter)
    const outputMerger = context.createChannelMerger(channelMap.length)
    for (let outputIndex = 0; outputIndex < channelMap.length; outputIndex++) {
        const sourceIndex = channelMap[outputIndex]
        splitter.connect(outputMerger, sourceIndex, outputIndex)
    }
    return outputMerger
}
