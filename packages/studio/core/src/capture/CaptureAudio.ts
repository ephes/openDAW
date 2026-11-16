import {
    Errors,
    Func,
    isDefined,
    isUndefined,
    MutableObservableOption,
    Nullable,
    Option,
    RuntimeNotifier,
    Terminable,
    tryCatch
} from "@opendaw/lib-std"
import {dbToGain} from "@opendaw/lib-dsp"
import {Promises} from "@opendaw/lib-runtime"
import {AudioUnitBox, CaptureAudioBox} from "@opendaw/studio-boxes"
import {Capture} from "./Capture"
import {CaptureDevices} from "./CaptureDevices"
import {RecordAudio} from "./RecordAudio"
import {AudioDevices} from "../AudioDevices"
import {RenderQuantum} from "../RenderQuantum"
import {RecordingWorklet} from "../RecordingWorklet"
import {MonitoringMode} from "./MonitoringMode"

export class CaptureAudio extends Capture<CaptureAudioBox> {
    readonly #stream: MutableObservableOption<MediaStream>
    readonly #streamGenerator: Func<void, Promise<void>>
    readonly #monitorGainNode: GainNode
    readonly #monitorPanNode: StereoPannerNode

    #monitorSelection = 0
    #retired = false
    #monitoringMode: MonitoringMode = "off"
    #requestChannels: Option<1 | 2> = Option.None
    #gainDb: number = 0.0
    #monitorVolumeDb: number = 0.0
    #monitorPan: number = 0.0
    #monitorMuted: boolean = false
    #audioChain: Nullable<{
        sourceNode: MediaStreamAudioSourceNode
        recordGainNode: GainNode
        channelCount: 1 | 2
    }> = null
    #preparedCleanup: Terminable = Terminable.Empty
    #preparedWorklet: Nullable<RecordingWorklet> = null
    #monitorOutputDeviceId: Option<string> = Option.None
    #monitorAudioElement: Nullable<HTMLAudioElement> = null
    #monitorStreamDest: Nullable<MediaStreamAudioDestinationNode> = null

    constructor(manager: CaptureDevices, audioUnitBox: AudioUnitBox, captureAudioBox: CaptureAudioBox) {
        super(manager, audioUnitBox, captureAudioBox)
        const {audioContext} = this.manager.project.env
        this.#monitorGainNode = audioContext.createGain()
        this.#monitorGainNode.gain.value = dbToGain(this.#monitorVolumeDb)
        this.#monitorPanNode = audioContext.createStereoPanner()
        this.#monitorPanNode.pan.value = this.#monitorPan
        this.#monitorGainNode.connect(this.#monitorPanNode)
        this.#stream = new MutableObservableOption<MediaStream>()
        this.#streamGenerator = Promises.sequentialize(() => this.#updateStream())
        this.ownAll(
            Terminable.create(() => {
                this.#retired = true
                this.#monitorSelection++
                Terminable.many(
                    {terminate: () => this.#preparedCleanup.terminate()},
                    {terminate: () => {
                        this.#monitorAudioElement?.pause()
                        if (this.#monitorAudioElement !== null) {this.#monitorAudioElement.srcObject = null}
                        this.#monitorStreamDest?.disconnect()
                        this.#monitorAudioElement = null
                        this.#monitorStreamDest = null
                        this.#monitorGainNode.disconnect()
                        this.#monitorPanNode.disconnect()
                    }},
                    {terminate: () => this.#stopStream()}
                ).terminate()
            }),
            captureAudioBox.requestChannels.catchupAndSubscribe(owner => {
                const channels = owner.getValue()
                this.#requestChannels = channels === 1 || channels === 2 ? Option.wrap(channels) : Option.None
                this.#stream.ifSome(stream => this.#rebuildAudioChain(stream))
            }),
            captureAudioBox.gainDb.catchupAndSubscribe(owner => {
                this.#gainDb = owner.getValue()
                if (isDefined(this.#audioChain)) {
                    this.#audioChain.recordGainNode.gain.value = dbToGain(this.#gainDb)
                }
            }),
            captureAudioBox.deviceId.catchupAndSubscribe(async () => {
                if (this.armed.getValue()) {
                    await this.#streamGenerator()
                }
            }),
            this.armed.catchupAndSubscribe(async owner => {
                const armed = owner.getValue()
                if (armed) {
                    await this.#streamGenerator()
                } else {
                    this.#stopStream()
                }
            })
        )
    }

    get isMonitoring(): boolean {return this.#monitoringMode !== "off"}
    get monitoringMode(): MonitoringMode {return this.#monitoringMode}
    set monitoringMode(value: MonitoringMode) {
        if (this.#monitoringMode === value) {return}
        this.#disconnectMonitoring()
        this.#monitoringMode = value
        if (this.#monitoringMode !== "off") {
            this.armed.setValue(true)
        }
        this.#connectMonitoring()
    }
    get gainDb(): number {return this.#gainDb}
    get requestChannels(): Option<1 | 2> {return this.#requestChannels}
    set requestChannels(value: 1 | 2) {this.captureBox.requestChannels.setValue(value)}
    get stream(): MutableObservableOption<MediaStream> {return this.#stream}
    get streamDeviceId(): Option<string> {
        return this.streamMediaTrack.map(settings => settings.getSettings().deviceId ?? "")
    }
    get label(): string {return this.streamMediaTrack.mapOr(track => track.label, "Default")}
    get deviceLabel(): Option<string> {return this.streamMediaTrack.map(track => track.label ?? "")}
    get streamMediaTrack(): Option<MediaStreamTrack> {
        return this.#stream.flatMap(stream => Option.wrap(stream.getAudioTracks().at(0)))
    }
    get outputNode(): Option<AudioNode> {return Option.wrap(this.#audioChain?.recordGainNode)}
    get effectiveChannelCount(): number {return this.#audioChain?.channelCount ?? 1}
    get monitorGainNode(): GainNode {return this.#monitorGainNode}
    get monitorPanNode(): StereoPannerNode {return this.#monitorPanNode}
    get monitorVolumeDb(): number {return this.#monitorVolumeDb}
    set monitorVolumeDb(value: number) {
        this.#monitorVolumeDb = value
        this.#monitorGainNode.gain.value = this.#monitorMuted ? 0 : dbToGain(this.#monitorVolumeDb)
    }
    get monitorPan(): number {return this.#monitorPan}
    set monitorPan(value: number) {
        this.#monitorPan = value
        this.#monitorPanNode.pan.value = value
    }
    get monitorMuted(): boolean {return this.#monitorMuted}
    set monitorMuted(value: boolean) {
        this.#monitorMuted = value
        this.#monitorGainNode.gain.value = value ? 0 : dbToGain(this.#monitorVolumeDb)
    }
    get monitorOutputDeviceId(): Option<string> {return this.#monitorOutputDeviceId}

    async setMonitorOutputDevice(deviceId: Option<string>): Promise<void> {
        if (this.#retired) {return}
        const selection = ++this.#monitorSelection
        let destination: Nullable<MediaStreamAudioDestinationNode> = null
        let audio: Nullable<HTMLAudioElement> = null
        let outputId = deviceId
        const retireCandidate = (): void => {
            if (audio !== null) {audio.pause(); audio.srcObject = null}
            destination?.disconnect()
        }
        const current = (): boolean => !this.#retired && selection === this.#monitorSelection
        if (deviceId.nonEmpty()) {
            try {
                destination = this.manager.project.env.audioContext.createMediaStreamDestination()
                audio = new Audio()
                audio.srcObject = destination.stream
                await audio.setSinkId(deviceId.unwrap())
                if (!current()) {retireCandidate(); return}
                await audio.play()
            } catch {
                retireCandidate()
                if (!current()) {return}
                destination = null
                audio = null
                outputId = Option.None
                void RuntimeNotifier.info({headline: "Output Device Error", message: "Could not select output device; using default output"}).catch(() => {})
            }
        }
        if (!current()) {retireCandidate(); return}
        const oldDestination = this.#monitorDestination()
        if (this.#monitoringMode !== "off" && isDefined(this.#audioChain)) {
            this.#monitorPanNode.disconnect(oldDestination)
        }
        this.#monitorAudioElement?.pause()
        if (this.#monitorAudioElement !== null) {this.#monitorAudioElement.srcObject = null}
        this.#monitorStreamDest?.disconnect()
        this.#monitorAudioElement = audio
        this.#monitorStreamDest = destination
        this.#monitorOutputDeviceId = outputId
        if (this.#monitoringMode !== "off" && isDefined(this.#audioChain)) {
            this.#monitorPanNode.connect(this.#monitorDestination())
        }
    }

    async prepareRecording(): Promise<Terminable> {
        if (this.#retired) {throw Errors.AbortError}
        const {project} = this.manager
        const {env: {audioContext, audioWorklets, sampleManager, sampleService}} = project
        if (isUndefined(audioContext.outputLatency)) {
            const approved = await RuntimeNotifier.approve({
                headline: "Warning",
                message: "Your browser does not support 'output latency'. This will cause timing issue while recording.",
                approveText: "Ignore",
                cancelText: "Cancel"
            })
            if (!approved) {
                return Promise.reject("Recording cancelled")
            }
        }
        await this.#streamGenerator()
        if (this.#retired) {throw Errors.AbortError}
        const audioChain = this.#audioChain
        if (!isDefined(audioChain)) {
            return Promise.reject("No audio chain available for recording.")
        }
        const {recordGainNode, channelCount} = audioChain
        this.#preparedCleanup.terminate()
        const recordingWorklet = audioWorklets.createRecording(channelCount, RenderQuantum)
        this.#preparedWorklet = recordingWorklet
        const cleanup = this.#preparedCleanup = {
            terminate: (): void => {
                if (this.#preparedWorklet !== recordingWorklet) {return}
                this.#preparedWorklet = null
                this.#preparedCleanup = Terminable.Empty
                Terminable.many(
                    {terminate: () => recordingWorklet.terminate()},
                    {terminate: () => recordingWorklet.disconnect()},
                    {terminate: () => sampleManager.remove(recordingWorklet.uuid)},
                    {terminate: () => {tryCatch(() => recordGainNode.disconnect(recordingWorklet))}}
                ).terminate()
            }
        }
        try {
            recordingWorklet.bpm = project.timelineBox.bpm.getValue()
            recordingWorklet.sampleService = sampleService
            sampleManager.record(recordingWorklet)
            recordGainNode.connect(recordingWorklet)
            return cleanup
        } catch (error) {
            tryCatch(() => cleanup.terminate())
            throw error
        }
    }

    startRecording(): Terminable {
        const {project} = this.manager
        const {env: {audioContext, sampleManager}} = project
        const audioChain = this.#audioChain
        const recordingWorklet = this.#preparedWorklet
        if (!isDefined(audioChain) || !isDefined(recordingWorklet)) {
            console.warn("No audio chain or worklet available for recording.")
            return Terminable.Empty
        }
        const {recordGainNode} = audioChain
        const track = this.#stream.unwrapOrNull()?.getAudioTracks().at(0)
        const trackSettings = track?.getSettings()
        console.debug("[CaptureAudio] latency report", {
            outputLatency: audioContext.outputLatency,
            baseLatency: audioContext.baseLatency,
            inputLatencyReported: trackSettings?.latency
        })
        try {
            const recording = RecordAudio.start({
                recordingWorklet,
                sourceNode: recordGainNode,
                sampleManager,
                project,
                capture: this,
                outputLatency: audioContext.outputLatency ?? 0
            })
            // Transfer ownership only after startup returned its cleanup handle.
            this.#preparedWorklet = null
            this.#preparedCleanup = Terminable.Empty
            return recording
        } catch (error) {
            tryCatch(() => this.#preparedCleanup.terminate())
            throw error
        }
    }

    async #updateStream(): Promise<void> {
        if (this.#retired) {return}
        if (this.#stream.nonEmpty()) {
            const stream = this.#stream.unwrap()
            const settings = stream.getAudioTracks().at(0)?.getSettings()
            if (isDefined(settings)) {
                const deviceId = this.deviceId.getValue().unwrapOrUndefined()
                if (deviceId === settings.deviceId) {
                    return Promise.resolve()
                }
            }
        }
        this.#stopStream()
        const deviceId = this.deviceId.getValue().unwrapOrUndefined() ?? AudioDevices.defaultInput?.deviceId
        const channelCount = this.#requestChannels.unwrapOrElse(2)
        const baseConstraints: MediaTrackConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: {ideal: channelCount}
        }
        // `exact` forces the browser to honor the requested deviceId; if the
        // device is gone (USB unplug, OS swap, ...), getUserMedia rejects.
        // Fall back to a stream without a deviceId constraint, so recording
        // still works on the default input rather than failing outright.
        const stream = await AudioDevices.requestStream({
            ...baseConstraints,
            deviceId: isDefined(deviceId) ? {exact: deviceId} : undefined
        }).catch(error => {
            if (!isDefined(deviceId)) {throw error}
            console.warn("Requested audio device unavailable; using default input")
            return AudioDevices.requestStream(baseConstraints)
        })
        const tracks = stream.getAudioTracks()
        if (this.#retired) {tracks.forEach(track => track.stop()); return}
        const track = tracks.at(0)
        const settings = track?.getSettings()
        console.debug("[CaptureAudio] stream channels", {requested: channelCount, actual: settings?.channelCount})
        this.#rebuildAudioChain(stream)
        this.#stream.wrap(stream)
    }

    #stopStream(): void {
        this.#disconnectMonitoring()
        this.#destroyAudioChain()
        this.#stream.clear(stream => stream.getAudioTracks().forEach(track => track.stop()))
    }

    #rebuildAudioChain(stream: MediaStream): void {
        this.#disconnectMonitoring()
        this.#destroyAudioChain()
        const {audioContext} = this.manager.project.env
        const sourceNode = audioContext.createMediaStreamSource(stream)
        const recordGainNode = audioContext.createGain()
        recordGainNode.gain.value = dbToGain(this.#gainDb)
        const streamChannelCount: 1 | 2 = Math.min(stream.getAudioTracks().at(0)?.getSettings().channelCount ?? 2, 2) as 1 | 2
        const channelCount = this.#requestChannels.unwrapOrElse(streamChannelCount)
        recordGainNode.channelCount = channelCount
        recordGainNode.channelCountMode = "explicit"
        sourceNode.connect(recordGainNode)
        this.#audioChain = {sourceNode, recordGainNode, channelCount}
        this.#connectMonitoring()
    }

    #destroyAudioChain(): void {
        if (isDefined(this.#audioChain)) {
            const {sourceNode, recordGainNode} = this.#audioChain
            sourceNode.disconnect()
            recordGainNode.disconnect()
            this.#audioChain = null
        }
    }

    #monitorDestination(): AudioNode {
        return this.#monitorStreamDest ?? this.manager.project.env.audioContext.destination
    }

    #connectMonitoring(): void {
        if (!isDefined(this.#audioChain)) {return}
        const {sourceNode, channelCount} = this.#audioChain
        switch (this.#monitoringMode) {
            case "off":
                break
            case "direct":
                sourceNode.connect(this.#monitorGainNode)
                this.#monitorPanNode.connect(this.#monitorDestination())
                break
            case "effects":
                this.manager.project.engine.registerMonitoringSource(
                    this.audioUnitBox.address.uuid, sourceNode, channelCount, this.#monitorGainNode)
                this.#monitorPanNode.connect(this.#monitorDestination())
                break
        }
    }

    #disconnectMonitoring(): void {
        if (!isDefined(this.#audioChain)) {return}
        switch (this.#monitoringMode) {
            case "off":
                break
            case "direct":
                this.#audioChain.sourceNode.disconnect(this.#monitorGainNode)
                this.#monitorPanNode.disconnect(this.#monitorDestination())
                break
            case "effects":
                this.manager.project.engine.unregisterMonitoringSource(this.audioUnitBox.address.uuid)
                this.#monitorPanNode.disconnect(this.#monitorDestination())
                break
        }
    }
}
