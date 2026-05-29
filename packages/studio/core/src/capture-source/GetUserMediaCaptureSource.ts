import {int, isDefined, Terminator} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {CaptureChannelMap} from "./CaptureChannelMap"
import {CaptureSource, CaptureSourceMetadata} from "./CaptureSourceTypes"

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
        // The PCM that flows from createMediaStreamSource into the worklet is clocked by the
        // AudioContext, not by the input device. If the browser resamples between the device
        // and the graph (e.g. 44.1 kHz mic into a 48 kHz context), the recorder must use the
        // context rate; the device-reported rate stays in metadata as diagnostic info only,
        // and stays undefined when the browser does not report one.
        const actualSampleRate = context.sampleRate
        const sourceNode = context.createMediaStreamSource(stream)
        const channelMap = options.channelMap ?? CaptureChannelMap.identity(actualChannels)
        CaptureChannelMap.validate(channelMap, actualChannels)
        const outputNode = CaptureChannelMap.isIdentity(channelMap) && channelMap.length === actualChannels
            ? sourceNode
            : CaptureChannelMap.route(context, sourceNode, actualChannels, channelMap)
        const metadata = CaptureSourceMetadata.fromMediaStreamTrack(track, {
            requestedSampleRate: context.sampleRate,
            requestedChannels,
            actualSampleRate,
            actualChannels: channelMap.length
        })
        return new GetUserMediaCaptureSource(stream, metadata, outputNode)
    }

    get metadata(): CaptureSourceMetadata {return this.#metadata}

    get outputNode(): AudioNode {return this.#outputNode}

    get mediaStream(): MediaStream {return this.#stream}

    terminate(): void {this.#terminator.terminate()}
}
