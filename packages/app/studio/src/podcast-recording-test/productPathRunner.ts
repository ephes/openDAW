import {isDefined, Notifier, Observer, Option, Progress, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {AnimationFrame} from "@opendaw/lib-dom"
import {AudioUnitType, IconSymbol} from "@opendaw/studio-enums"
import {
    AudioFileBox,
    AudioRegionBox,
    CaptureAudioBox,
    TrackBox
} from "@opendaw/studio-boxes"
import {
    AudioUnitFactory,
    InstrumentFactories,
    SampleLoaderState,
    SampleMetaData,
    TrackType
} from "@opendaw/studio-adapters"
import {AudioData} from "@opendaw/lib-dsp"
import {
    AudioWorklets,
    CaptureAudio,
    GlobalSampleLoaderManager,
    GlobalSoundfontLoaderManager,
    LongRecordingArtifact,
    LongRecordingSession,
    OfflineEngineRenderer,
    Project,
    ProjectBundle,
    ProjectMeta,
    ProjectProfile,
    Recording,
    SampleService,
    SoundfontService,
    Workers
} from "@opendaw/studio-core"

export interface ProductPathTestConfig {
    readonly workersUrl: string
    readonly workletsUrl: string
    readonly offlineEngineUrl: string
}

export interface ProductPathTestEvent {
    readonly kind: "log" | "stage"
    readonly message: string
}

export interface ProductPathTestSummary {
    readonly opfsCheckPassed: boolean
    readonly persistenceRequested: boolean
    readonly recordingsBeforeStop: number
    readonly recordingsAfterStop: number
    readonly artifactClassification: string
    readonly recordingId: UUID.String
    readonly consumerLoaderState: string
    readonly consumerLoaderHasData: boolean
    readonly consumerLoaderHasPeaks: boolean
    readonly consumerLoaderFrames: number
    readonly playbackPositionAdvanced: boolean
    readonly bundleRoundTripLoaderState: string
    readonly bundleRoundTripLoaderHasData: boolean
    readonly bundleRoundTripLoaderHasPeaks: boolean
    readonly bundleRoundTripRegionAttached: boolean
    readonly exportNumFrames: number
    readonly exportNonZeroSamples: number
    readonly regionDurationSeconds: number
    readonly trackUserCreatedSampleObserved: boolean
}

export type ProductPathTestResult =
    | {readonly status: "pass", readonly recordingId: UUID.String, readonly summary: ProductPathTestSummary}
    | {readonly status: "fail", readonly reason: string}
    | {readonly status: "error", readonly error: unknown}

export interface ProductPathTestRunHandle {
    readonly resultPromise: Promise<ProductPathTestResult>
    subscribeEvents(observer: Observer<ProductPathTestEvent>): Subscription
}

const installInfrastructureOnce = async (
    workersUrl: string, workletsUrl: string, offlineEngineUrl: string
): Promise<void> => {
    if (Workers.messenger.isEmpty()) {
        await Workers.install(workersUrl)
    }
    AudioWorklets.install(workletsUrl)
    OfflineEngineRenderer.install(offlineEngineUrl)
}

const buildProject = async (audioContext: AudioContext): Promise<{
    project: Project
    captureAudioBox: CaptureAudioBox
    audioUnitUuid: UUID.Bytes
}> => {
    const audioWorklets = await AudioWorklets.createFor(audioContext)
    const sampleService = new SampleService(audioContext)
    const soundfontService = new SoundfontService()
    const sampleManager = new GlobalSampleLoaderManager({
        fetch: (_uuid: UUID.Bytes, _progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> =>
            Promise.reject(new Error("api provider not configured for product-path test"))
    }, {opfsProvider: () => Workers.Opfs})
    const soundfontManager = new GlobalSoundfontLoaderManager({
        fetch: () => Promise.reject(new Error("soundfont api not configured for product-path test"))
    })
    const project = Project.new({
        audioContext,
        audioWorklets,
        sampleManager,
        soundfontManager,
        sampleService,
        soundfontService
    })
    const created: {captureBox: Option<CaptureAudioBox>, audioUnitUuid: Option<UUID.Bytes>} = {
        captureBox: Option.None, audioUnitUuid: Option.None
    }
    project.editing.modify(() => {
        const captureBox = CaptureAudioBox.create(project.boxGraph, UUID.generate())
        const audioUnit = AudioUnitFactory.create(
            project.skeleton, AudioUnitType.Instrument, Option.wrap(captureBox))
        // The audio unit needs an instrument on its `input` for filterArmed() to include it,
        // and so the engine can route the recording. Tape is the audio-track instrument used
        // by openDAW for audio capture tracks.
        InstrumentFactories.Tape.create(project.boxGraph, audioUnit.input, "Tape", IconSymbol.Tape)
        const trackBox = TrackBox.create(project.boxGraph, UUID.generate(), box => {
            box.tracks.refer(audioUnit.tracks)
            box.type.setValue(TrackType.Audio)
            box.index.setValue(0)
            box.target.refer(audioUnit)
        })
        // Keep the track around for the engine to find; reference it via the closure too so
        // the box graph subscription has an attached track.
        void trackBox
        created.captureBox = Option.wrap(captureBox)
        created.audioUnitUuid = Option.wrap(audioUnit.address.uuid)
    }, false)
    return {
        project,
        captureAudioBox: created.captureBox.unwrap("CaptureAudioBox creation failed"),
        audioUnitUuid: created.audioUnitUuid.unwrap("AudioUnitBox creation failed")
    }
}

const waitArmedStream = async (capture: CaptureAudio, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (capture.stream.nonEmpty()) {return}
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error("getUserMedia stream did not open within timeout")
}

const performProductRun = async (config: ProductPathTestConfig, events: Notifier<ProductPathTestEvent>):
Promise<ProductPathTestResult> => {
    const log = (message: string): void => events.notify({kind: "log", message})
    const stage = (message: string): void => events.notify({kind: "stage", message})
    stage("install infrastructure")
    await installInfrastructureOnce(config.workersUrl, config.workletsUrl, config.offlineEngineUrl)
    AnimationFrame.start(window)
    stage("opfs support check")
    const opfsCheckResult = await Promises.tryCatch(Promise.resolve(LongRecordingSession.assertOpfsSupported()))
    const opfsCheckPassed = opfsCheckResult.status === "resolved"
    if (!opfsCheckPassed) {
        return {status: "fail", reason: "LongRecordingSession.assertOpfsSupported threw: "
            + String(opfsCheckResult.error)}
    }
    const persistenceRequested = await LongRecordingSession.requestPersistence()
    log(`OPFS supported, persistent storage granted=${persistenceRequested}`)
    stage("build project")
    const audioContext = new AudioContext({sampleRate: 48000, latencyHint: 0})
    if (audioContext.state === "suspended") {await audioContext.resume()}
    const {project, captureAudioBox, audioUnitUuid} = await buildProject(audioContext)
    log(`project created, captureAudioBox.longRecording (default)=${captureAudioBox.longRecording.getValue()}`)
    stage("enable long recording")
    project.editing.modify(() => {captureAudioBox.longRecording.setValue(true)}, false)
    const captureOption = project.captureDevices.get(audioUnitUuid)
    if (captureOption.isEmpty()) {
        return {status: "fail", reason: "CaptureDevices did not produce a Capture for the audio unit"}
    }
    const capture = captureOption.unwrap()
    if (!(capture instanceof CaptureAudio)) {
        return {status: "fail", reason: "Capture for audio unit is not CaptureAudio"}
    }
    log(`captureAudio resolved, longRecording=${capture.captureBox.longRecording.getValue()}`)
    stage("arm capture")
    capture.armed.setValue(true)
    await waitArmedStream(capture, 5000)
    log(`stream opened; effectiveChannels=${capture.effectiveChannelCount}`)
    const recordingsBeforeStop = (await LongRecordingArtifact.probeAll(Workers.Opfs)).length
    let trackUserCreatedSampleObserved = false
    let observedUserCreatedUuid: UUID.Bytes | undefined
    const originalTrack = project.trackUserCreatedSample.bind(project)
    project.trackUserCreatedSample = (uuid: UUID.Bytes): void => {
        observedUserCreatedUuid = uuid
        trackUserCreatedSampleObserved = true
        originalTrack(uuid)
    }
    stage("start audio worklet (real engine)")
    const worklet = project.startAudioWorklet()
    await worklet.isReady()
    log("EngineWorklet ready")
    stage("Recording.start (drives engine.isRecording, then prepareRecording long branch + startRecording)")
    const recordingTerminable = await Recording.start(project, false)
    log("Recording.start armed")
    // Wait for the engine to actually transition isRecording=true on the worklet -> facade path.
    const ready = await Promises.tryCatch(new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("engine.isRecording never became true")), 3000)
        const subscription = project.engine.isRecording.subscribe(() => {
            if (project.engine.isRecording.getValue()) {
                clearTimeout(timeout)
                subscription.terminate()
                resolve()
            }
        })
        // Catch up: engine may already be recording on subscribe
        if (project.engine.isRecording.getValue()) {
            clearTimeout(timeout)
            subscription.terminate()
            resolve()
        }
    }))
    if (ready.status === "rejected") {
        project.terminate()
        await audioContext.close().catch(() => {})
        recordingTerminable.terminate()
        return {status: "fail", reason: "engine.isRecording never became true: " + String(ready.error)}
    }
    log("engine.isRecording=true observed")
    await new Promise(resolve => setTimeout(resolve, 1500))
    stage("stop")
    project.engine.stopRecording()
    // Recording.start subscribes to engine.isRecording/isCountingIn; stopRecording flips them
    // to false; the subscriber terminates the captures. Allow time for the editing
    // transaction (which finalizes box durations) and the async session.stop() to settle.
    await new Promise(resolve => setTimeout(resolve, 1000))
    const probes = await LongRecordingArtifact.probeAll(Workers.Opfs)
    const recordingsAfterStop = probes.length
    log(`recordings on disk: before=${recordingsBeforeStop} after=${recordingsAfterStop}`)
    const newProbes = probes.slice(recordingsBeforeStop)
    const lastProbe = newProbes.at(-1) ?? probes.at(-1)
    const recordingId = isDefined(lastProbe)
        ? lastProbe.recordingId
        : UUID.asString("00000000-0000-4000-8000-000000000000")
    const classification = lastProbe?.report.recovery.overall ?? "missing"
    log(`new recording id=${recordingId} classification=${classification}`)
    if (recordingsAfterStop <= recordingsBeforeStop) {
        project.terminate()
        await audioContext.close().catch(() => {})
        return {status: "fail", reason: "no new long-recording artifact appeared after prepare+start+stop"}
    }
    stage("consumer chain: project sampleManager resolves long-recording uuid created by RecordAudioLong")
    // RecordAudioLong has already created an AudioFileBox + AudioRegionBox referencing the
    // recording (driven by engine.isRecording transitioning to true). We locate them in the
    // project's box graph and resolve the loader through the production sample manager.
    const recordingUuid = UUID.parse(recordingId)
    const observedTrackedMatchesRecording = isDefined(observedUserCreatedUuid)
        && UUID.equals(observedUserCreatedUuid, recordingUuid)
    log(`trackUserCreatedSample observed=${trackUserCreatedSampleObserved}`
        + ` matchesRecording=${observedTrackedMatchesRecording}`)
    const lastProbeUnwrapped = lastProbe
    if (!isDefined(lastProbeUnwrapped)) {
        project.terminate()
        await audioContext.close().catch(() => {})
        return {status: "fail", reason: "no probe entry for new recording"}
    }
    const manifestTotalFrames = lastProbeUnwrapped.report.manifest.totalFrames
    const manifestSampleRate = lastProbeUnwrapped.report.manifest.sampleRate
    const regionDurationSeconds = manifestTotalFrames / Math.max(1, manifestSampleRate)
    const audioFileBoxes = project.boxGraph.boxes()
        .filter(box => box instanceof AudioFileBox)
        .filter(box => UUID.equals(box.address.uuid, recordingUuid))
    if (audioFileBoxes.length === 0) {
        project.terminate()
        await audioContext.close().catch(() => {})
        return {
            status: "fail",
            reason: "no AudioFileBox was created for the recording by RecordAudioLong"
        }
    }
    const audioRegionBoxes = project.boxGraph.boxes()
        .filter(box => box instanceof AudioRegionBox)
    log(`audioFileBoxes for recording=${audioFileBoxes.length}, audioRegionBoxes total=${audioRegionBoxes.length}`)
    const consumerLoader = project.sampleManager.getOrCreate(recordingUuid)
    const consumerTerminal = await waitForLoaderTerminal(consumerLoader)
    const consumerLoaderHasData = consumerLoader.data.nonEmpty()
    const consumerLoaderHasPeaks = consumerLoader.peaks.nonEmpty()
    const consumerLoaderFrames = consumerLoader.data.mapOr(audio => audio.numberOfFrames, 0)
    log(`consumer loader: state=${consumerTerminal.type} data=${consumerLoaderHasData}`
        + ` peaks=${consumerLoaderHasPeaks} frames=${consumerLoaderFrames}`)
    stage("playback: project.engine.play() and verify position advances over the recorded region")
    project.engine.setPosition(0)
    const positionBefore = project.engine.position.getValue()
    project.engine.play()
    const playbackTimeoutMs = 4000
    const playbackAdvanced = await Promises.tryCatch(new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("engine.position did not advance during playback")), playbackTimeoutMs)
        const subscription = project.engine.position.subscribe(() => {
            if (project.engine.position.getValue() > positionBefore + 1) {
                clearTimeout(timeout)
                subscription.terminate()
                resolve()
            }
        })
    }))
    project.engine.stop()
    const playbackPositionAdvanced = playbackAdvanced.status === "resolved"
    log(`playback: position advanced=${playbackPositionAdvanced} (positionBefore=${positionBefore},`
        + ` positionAfter=${project.engine.position.getValue()})`)
    stage("export: OfflineEngineRenderer mixdown")
    const exportSampleRate = 48000
    const exportFrames = Math.min(48000, Math.floor(regionDurationSeconds * exportSampleRate))
    // OfflineEngineRenderer cannot share the project's already-connected liveStreamReceiver, so
    // we render against a fresh copy of the project (the same pattern AudioConsolidation uses).
    const exportProject = project.copy()
    const exportResult = await Promises.tryCatch((async () => {
        const renderer = await OfflineEngineRenderer.create(exportProject, Option.None, exportSampleRate)
        try {
            await renderer.waitForLoading()
            renderer.setPosition(0)
            renderer.play()
            await renderer.waitForLoading()
            return await renderer.step(exportFrames)
        } finally {
            renderer.terminate()
        }
    })())
    if (exportResult.status === "rejected") {
        project.terminate()
        await audioContext.close().catch(() => {})
        return {status: "fail", reason: "OfflineEngineRenderer failed: " + String(exportResult.error)}
    }
    const exportFramesArray = exportResult.value
    const exportLeft = exportFramesArray[0] ?? new Float32Array(0)
    const exportRight = exportFramesArray[1] ?? exportLeft
    const exportNumFrames = exportLeft.length
    let exportNonZeroSamples = 0
    for (let index = 0; index < exportNumFrames; index++) {
        if (Math.abs(exportLeft[index]) > 1e-6 || Math.abs(exportRight[index]) > 1e-6) {
            exportNonZeroSamples++
        }
    }
    log(`export: mixdown rendered frames=${exportNumFrames}, non-zero samples=${exportNonZeroSamples}`)
    stage("save/reopen: real ProjectBundle.encode + ProjectBundle.decode round trip")
    // Persist captureAudioBox.longRecording into the box-graph snapshot used by encode.
    project.editing.modify(() => {captureAudioBox.longRecording.setValue(true)}, false)
    const bundleProfile = new ProjectProfile(
        UUID.generate(), project, ProjectMeta.init("product-path-test"), Option.None)
    const bundleBytes = await Promises.tryCatch(
        ProjectBundle.encode(bundleProfile, Progress.Empty))
    if (bundleBytes.status === "rejected") {
        project.terminate()
        await audioContext.close().catch(() => {})
        return {status: "fail", reason: "ProjectBundle.encode failed: " + String(bundleBytes.error)}
    }
    log(`ProjectBundle.encode produced ${bundleBytes.value.byteLength} bytes`)
    // Tear down the source project before decode so we are sure the reopened project is fresh.
    project.terminate()
    await audioContext.close().catch(() => {})
    const reopenAudioContext = new AudioContext({sampleRate: 48000, latencyHint: 0})
    if (reopenAudioContext.state === "suspended") {await reopenAudioContext.resume()}
    const reopenWorklets = await AudioWorklets.createFor(reopenAudioContext)
    const reopenSampleService = new SampleService(reopenAudioContext)
    const reopenSoundfontService = new SoundfontService()
    const reopenSampleManager = new GlobalSampleLoaderManager({
        fetch: () => Promise.reject(new Error("api not configured for product-path reopen"))
    }, {opfsProvider: () => Workers.Opfs})
    const reopenSoundfontManager = new GlobalSoundfontLoaderManager({
        fetch: () => Promise.reject(new Error("soundfont api not configured for product-path reopen"))
    })
    const decodedProfile = await Promises.tryCatch(ProjectBundle.decode({
        audioContext: reopenAudioContext,
        audioWorklets: reopenWorklets,
        sampleManager: reopenSampleManager,
        soundfontManager: reopenSoundfontManager,
        sampleService: reopenSampleService,
        soundfontService: reopenSoundfontService
    }, bundleBytes.value))
    if (decodedProfile.status === "rejected") {
        await reopenAudioContext.close().catch(() => {})
        return {status: "fail", reason: "ProjectBundle.decode failed: " + String(decodedProfile.error)}
    }
    const reopenedProject = decodedProfile.value.project
    log(`ProjectBundle.decode rehydrated project; box count=${reopenedProject.boxGraph.boxes().length}`)
    const reopenAudioFileBoxes = reopenedProject.boxGraph.boxes()
        .filter(box => box instanceof AudioFileBox)
        .filter(box => UUID.equals(box.address.uuid, recordingUuid))
    const reopenAudioRegionBoxes = reopenedProject.boxGraph.boxes()
        .filter(box => box instanceof AudioRegionBox)
    // Strong assertion: at least one AudioRegionBox's file pointer must actually target the
    // recording's AudioFileBox after decode. "Some AudioFileBox exists + some AudioRegionBox
    // exists" is too weak — they could be unrelated. Mirrors how production resolves
    // region.file.targetVertex in MigrateAudioRegionBox / DawProjectExporter.
    const reopenRegionsTargetingRecording = reopenAudioRegionBoxes.filter(region => {
        const target = (region as AudioRegionBox).file.targetVertex
        if (target.isEmpty()) {return false}
        return UUID.equals(target.unwrap().box.address.uuid, recordingUuid)
    })
    const bundleRoundTripRegionAttached = reopenAudioFileBoxes.length > 0
        && reopenRegionsTargetingRecording.length > 0
    log(`reopened: AudioFileBoxes for recording=${reopenAudioFileBoxes.length}`
        + ` AudioRegionBoxes total=${reopenAudioRegionBoxes.length}`
        + ` regionsTargetingRecording=${reopenRegionsTargetingRecording.length}`)
    const reopenedLoader = reopenedProject.sampleManager.getOrCreate(recordingUuid)
    const reopenedTerminal = await waitForLoaderTerminal(reopenedLoader)
    const bundleRoundTripLoaderHasData = reopenedLoader.data.nonEmpty()
    const bundleRoundTripLoaderHasPeaks = reopenedLoader.peaks.nonEmpty()
    log(`reopened loader: state=${reopenedTerminal.type} data=${bundleRoundTripLoaderHasData}`
        + ` peaks=${bundleRoundTripLoaderHasPeaks}`)
    reopenedProject.terminate()
    await reopenAudioContext.close().catch(() => {})
    const contractOk = consumerTerminal.type === "loaded"
        && consumerLoaderHasData && consumerLoaderHasPeaks
        && observedTrackedMatchesRecording
        && classification === "clean"
        && playbackPositionAdvanced
        && exportNonZeroSamples > 0
        && bundleRoundTripRegionAttached
        && reopenedTerminal.type === "loaded"
        && bundleRoundTripLoaderHasData && bundleRoundTripLoaderHasPeaks
    if (!contractOk) {
        return {
            status: "fail",
            reason: `product-path contract violated: consumer=${consumerTerminal.type}`
                + ` data=${consumerLoaderHasData} peaks=${consumerLoaderHasPeaks}`
                + ` userTracked=${observedTrackedMatchesRecording} classification=${classification}`
                + ` playbackAdvanced=${playbackPositionAdvanced} exportNonZero=${exportNonZeroSamples}`
                + ` reopenAttached=${bundleRoundTripRegionAttached} reopenLoader=${reopenedTerminal.type}`
                + ` reopenData=${bundleRoundTripLoaderHasData} reopenPeaks=${bundleRoundTripLoaderHasPeaks}`
        }
    }
    return {
        status: "pass",
        recordingId,
        summary: {
            opfsCheckPassed,
            persistenceRequested,
            recordingsBeforeStop,
            recordingsAfterStop,
            artifactClassification: classification,
            recordingId,
            consumerLoaderState: consumerTerminal.type,
            consumerLoaderHasData,
            consumerLoaderHasPeaks,
            consumerLoaderFrames,
            playbackPositionAdvanced,
            bundleRoundTripLoaderState: reopenedTerminal.type,
            bundleRoundTripLoaderHasData,
            bundleRoundTripLoaderHasPeaks,
            bundleRoundTripRegionAttached,
            exportNumFrames,
            exportNonZeroSamples,
            regionDurationSeconds,
            trackUserCreatedSampleObserved
        }
    }
}

const waitForLoaderTerminal = (
    loader: {subscribe: (observer: (state: SampleLoaderState) => void) => Terminable}
): Promise<SampleLoaderState> =>
    new Promise(resolve => {
        const subscription = loader.subscribe(state => {
            if (state.type === "loaded" || state.type === "error") {
                queueMicrotask(() => subscription.terminate())
                resolve(state)
            }
        })
    })

export const runProductPathTest = (config: ProductPathTestConfig): ProductPathTestRunHandle => {
    const events = new Notifier<ProductPathTestEvent>()
    const resultPromise = (async (): Promise<ProductPathTestResult> => {
        const attempt = await Promises.tryCatch(performProductRun(config, events))
        if (attempt.status === "rejected") {
            return {status: "error", error: attempt.error}
        }
        return attempt.value
    })()
    return {
        resultPromise,
        subscribeEvents: (observer: Observer<ProductPathTestEvent>): Subscription => events.subscribe(observer)
    }
}
