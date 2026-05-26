import {isDefined, Notifier, Observer, Subscription, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {
    AudioWorklets,
    CaptureSource,
    CaptureSourceMetadata,
    ChunkProbe,
    GetUserMediaCaptureSource,
    GlobalSampleLoaderManager,
    LongRecordingArtifact,
    LongRecordingChunkBuffer,
    LongRecordingManifest,
    LongRecordingMediaAccess,
    LongRecordingMediaReference,
    LongRecordingOverviewBin,
    LongRecordingRecovery,
    LongRecordingRecoveryReport,
    LongRecordingSampleLoader,
    LongRecordingService,
    LongRecordingSession,
    LongRecordingStorage,
    SyntheticCaptureSource,
    Workers
} from "@opendaw/studio-core"
import {SampleLoaderState} from "@opendaw/studio-adapters"

export type CaptureSourceKindArg = "synthetic" | "getUserMedia"

export interface PodcastRecordingTestConfig {
    readonly durationSeconds: number
    readonly numberOfChannels: 1 | 2
    readonly framesPerChunk: number
    readonly sampleRate?: number
    readonly captureSourceFactory?: (context: AudioContext) => CaptureSource | Promise<CaptureSource>
    readonly captureKind?: CaptureSourceKindArg
    readonly workersUrl: string
    readonly workletsUrl: string
}

export interface PodcastRecordingTestSuccess {
    readonly status: "pass"
    readonly recordingId: UUID.String
    readonly manifest: LongRecordingManifest
    readonly mediaReference: LongRecordingMediaReference
    readonly overviewBinCount: number
    readonly chunkProbes: ReadonlyArray<ChunkProbe>
    readonly recovery: LongRecordingRecoveryReport
    readonly captureMetadata: CaptureSourceMetadata
    readonly mismatches: ReadonlyArray<{
        readonly kind: string
        readonly message: string
    }>
    readonly firstChunkPreview: ReadonlyArray<number>
    readonly elapsedFramesDriftFrames: number
    readonly loaderProbe: LoaderProbeResult
}

export interface LoaderProbeResult {
    readonly peaksAvailableImmediately: boolean
    readonly peakNumFrames: number
    readonly peakStageCount: number
    readonly dataMaterialized: boolean
    readonly materializedFrames: number
    readonly fallbackResolved: boolean
    /**
     * The fallback loader must observe `progress -> loaded` with `data.nonEmpty()` after the long-recording
     * fallback has populated it. The previous swap-with-error pattern is rejected by the production consumers
     * (`AudioFileBoxAdapter.audioData`, `EngineWorklet.fetchAudio`, `OfflineEngineRenderer`).
     */
    readonly fallbackTerminalState: string
    readonly fallbackLoaderHasData: boolean
    readonly fallbackLoaderHasPeaks: boolean
    readonly fallbackLoaderIsSameInstanceAfterReload: boolean
    readonly fallbackLoaderAudioFrames: number
    readonly afterArtifactRestoreLoaderHasData: boolean
    readonly afterArtifactRestoreLoaderHasPeaks: boolean
}

export interface PodcastRecordingTestFailure {
    readonly status: "fail"
    readonly reason: string
    readonly recordingId: UUID.String
    readonly recovery: LongRecordingRecoveryReport
    readonly manifest: LongRecordingManifest
}

export interface PodcastRecordingTestError {
    readonly status: "error"
    readonly error: unknown
}

export type PodcastRecordingTestResult =
    | PodcastRecordingTestSuccess
    | PodcastRecordingTestFailure
    | PodcastRecordingTestError

export interface PodcastRecordingTestEvent {
    readonly kind: "log" | "progress" | "session-state" | "storage-error"
    readonly message: string
}

export interface PodcastRecordingTestRunHandle {
    readonly resultPromise: Promise<PodcastRecordingTestResult>
    subscribeEvents(observer: Observer<PodcastRecordingTestEvent>): Subscription
}

interface InternalConfig extends PodcastRecordingTestConfig {
    readonly events: Notifier<PodcastRecordingTestEvent>
}

const installInfrastructureOnce = async (workersUrl: string, workletsUrl: string): Promise<void> => {
    if (Workers.messenger.isEmpty()) {
        await Workers.install(workersUrl)
    }
    AudioWorklets.install(workletsUrl)
}

const buildCaptureSource = async (
    context: AudioContext,
    config: PodcastRecordingTestConfig
): Promise<CaptureSource> => {
    if (isDefined(config.captureSourceFactory)) {
        const result = config.captureSourceFactory(context)
        return result instanceof Promise ? result : Promise.resolve(result)
    }
    if (config.captureKind === "getUserMedia") {
        return GetUserMediaCaptureSource.open({
            context,
            requestedChannels: config.numberOfChannels
        })
    }
    return new SyntheticCaptureSource({
        context,
        numberOfChannels: config.numberOfChannels,
        label: `oscillator-${config.numberOfChannels}ch-${config.durationSeconds}s`
    })
}

const performRun = async (config: InternalConfig): Promise<PodcastRecordingTestResult> => {
    const {events} = config
    const log = (message: string): void => {
        events.notify({kind: "log", message})
    }
    LongRecordingSession.assertOpfsSupported()
    const persisted = await LongRecordingSession.requestPersistence()
    log(`navigator.storage.persist(): ${persisted}`)
    const sampleRate = config.sampleRate ?? 48000
    const context = new AudioContext({sampleRate, latencyHint: 0})
    log(`AudioContext sampleRate=${context.sampleRate}, state=${context.state}`)
    const workletsAttempt = await Promises.tryCatch(AudioWorklets.createFor(context))
    if (workletsAttempt.status === "rejected") {
        await context.close()
        return {status: "error", error: workletsAttempt.error}
    }
    const worklets = workletsAttempt.value
    if (context.state === "suspended") {await context.resume()}
    const recordingId = UUID.asString(crypto.randomUUID())
    log(`recording id: ${recordingId}`)
    const storage = LongRecordingStorage.create(recordingId, Workers.Opfs)
    const captureSource = await buildCaptureSource(context, config)
    const mismatchReports = CaptureSourceMetadata.mismatches(captureSource.metadata)
    const mismatches = mismatchReports.map(report => ({kind: report.kind, message: report.message}))
    for (const report of mismatchReports) {
        log(`capture-source warning: ${report.message}`)
    }
    log(`capture-source metadata: ${JSON.stringify(captureSource.metadata)}`)
    const handle = await LongRecordingService.startFromSource({
        worklets,
        storage,
        captureSource,
        framesPerChunk: config.framesPerChunk
    })
    handle.session.subscribeProgress(progress => {
        events.notify({
            kind: "progress",
            message: `frames=${progress.frames} chunks=${progress.chunks} bytes=${progress.bytes} elapsed=${progress.elapsedSeconds.toFixed(2)}s`
        })
    })
    handle.session.subscribeState(state => events.notify({kind: "session-state", message: state}))
    handle.session.subscribeStorageErrors(error => events.notify({kind: "storage-error", message: String(error)}))
    log(`capture-source connected — recording for ${config.durationSeconds}s`)
    await new Promise(resolve => setTimeout(resolve, config.durationSeconds * 1000))
    await handle.stop()
    await context.close()
    const reloadedOption = await storage.readManifest()
    if (reloadedOption.isEmpty()) {
        return {
            status: "fail",
            reason: "manifest missing after stop",
            recordingId,
            recovery: LongRecordingRecovery.classify(handle.session.manifest, []),
            manifest: handle.session.manifest
        }
    }
    const reloaded = reloadedOption.unwrap()
    const probes = await storage.listChunkProbes()
    const recovery = LongRecordingRecovery.classify(reloaded, probes)
    log(`manifest.state=${reloaded.state} totalFrames=${reloaded.totalFrames} chunks=${reloaded.chunks.length}`)
    log(`probes=${probes.length} overall=${recovery.overall}`)
    const expectedFrames = config.durationSeconds * context.sampleRate
    const driftFrames = Math.abs(reloaded.totalFrames - expectedFrames)
    log(`expected~${expectedFrames} got ${reloaded.totalFrames} drift ${driftFrames}`)
    if (recovery.overall !== "clean" || driftFrames >= context.sampleRate * 0.5) {
        return {
            status: "fail",
            reason: `recovery=${recovery.overall} drift=${driftFrames}`,
            recordingId,
            recovery,
            manifest: reloaded
        }
    }
    const reference = LongRecordingMediaReference.fromManifest(reloaded)
    const access = LongRecordingMediaAccess.create(reference, storage)
    const bins: ReadonlyArray<LongRecordingOverviewBin> = await access.readOverviewBins()
    const previewBytes = await storage.readChunk(0)
    const previewFrames = Math.min(reloaded.chunks[0].frames, 8)
    const previewChannels = LongRecordingChunkBuffer.deinterleave(
        previewBytes, config.numberOfChannels, previewFrames)
    const firstChunkPreview = Array.from(previewChannels[0]).slice(0, 8)
    log(`overview bins read without loading raw audio: ${bins.length}`)
    const loaderProbe = await probeSampleLoader(recordingId, reference, storage, log)
    if (!loaderProbe.fallbackResolved
        || !loaderProbe.afterArtifactRestoreLoaderHasData
        || !loaderProbe.afterArtifactRestoreLoaderHasPeaks) {
        return {
            status: "fail",
            reason: "long-recording loader contract violated: " + JSON.stringify(loaderProbe),
            recordingId,
            recovery,
            manifest: reloaded
        }
    }
    return {
        status: "pass",
        recordingId,
        manifest: reloaded,
        mediaReference: reference,
        overviewBinCount: bins.length,
        chunkProbes: probes,
        recovery,
        captureMetadata: captureSource.metadata,
        mismatches,
        firstChunkPreview,
        elapsedFramesDriftFrames: driftFrames,
        loaderProbe
    }
}

const probeSampleLoader = async (
    recordingId: UUID.String,
    reference: LongRecordingMediaReference,
    storage: LongRecordingStorage,
    log: (message: string) => void
): Promise<LoaderProbeResult> => {
    const uuid = UUID.parse(recordingId)
    const access = LongRecordingMediaAccess.create(reference, storage)
    const directLoader = await LongRecordingSampleLoader.create({uuid, reference, access, storage})
    const peaksAvailableImmediately = directLoader.peaks.nonEmpty()
    const peakNumFrames = directLoader.peaks.unwrap().numFrames
    const peakStageCount = directLoader.peaks.unwrap().stages.length
    log(`loader peaks: numFrames=${peakNumFrames} stages=${peakStageCount} immediate=${peaksAvailableImmediately}`)
    const audio = await directLoader.materializeAudioData()
    const dataMaterialized = directLoader.data.nonEmpty()
    log(`loader materialized: frames=${audio.numberOfFrames} channels=${audio.numberOfChannels}`)
    // Production-path: GlobalSampleLoaderManager.getOrCreate must transition the same loader instance
    // to "loaded" with data + peaks populated. This is the contract `AudioFileBoxAdapter.audioData`,
    // `EngineWorklet.fetchAudio`, and `OfflineEngineRenderer` all depend on. A second `getOrCreate`
    // must return the SAME loader (not a swap), and that loader must carry the materialized audio.
    const fallbackManager = new GlobalSampleLoaderManager({
        fetch: () => Promise.reject(new Error("api provider must not be invoked for long-recording uuid"))
    }, {opfsProvider: () => Workers.Opfs})
    const fallbackLoader = fallbackManager.getOrCreate(uuid)
    const fallbackTerminal = await waitForLoaderTerminal(fallbackLoader)
    const sameInstance = fallbackManager.getOrCreate(uuid) === fallbackLoader
    const fallbackLoaderHasData = fallbackLoader.data.nonEmpty()
    const fallbackLoaderHasPeaks = fallbackLoader.peaks.nonEmpty()
    const fallbackLoaderAudioFrames = fallbackLoader.data.mapOr(audio => audio.numberOfFrames, 0)
    const fallbackResolved = fallbackTerminal.type === "loaded"
        && fallbackLoaderHasData && fallbackLoaderHasPeaks && sameInstance
    const errorReason = fallbackTerminal.type === "error" ? fallbackTerminal.reason : ""
    log(`fallback loader: state=${fallbackTerminal.type}${errorReason ? ` reason="${errorReason}"` : ""}`
        + ` data=${fallbackLoaderHasData} peaks=${fallbackLoaderHasPeaks}`
        + ` sameInstance=${sameInstance} frames=${fallbackLoaderAudioFrames}`)
    // Simulate save/reopen: artifact collected from this OPFS, restored under a fresh recording id
    // (mirroring `ProjectBundle.encode/decode` which writes the bundle's recordings/<uuid>/ back into
    // OPFS at recordings/v1/<uuid>/), and resolved through a fresh GlobalSampleLoaderManager.
    const collected = await LongRecordingArtifact.collect(Workers.Opfs, recordingId)
    const restoredId = UUID.asString(crypto.randomUUID())
    const restoredUuid = UUID.parse(restoredId)
    await LongRecordingArtifact.restore(Workers.Opfs, restoredId, collected)
    const reloadedManager = new GlobalSampleLoaderManager({
        fetch: () => Promise.reject(new Error("api provider must not be invoked after artifact restore"))
    }, {opfsProvider: () => Workers.Opfs})
    const reloadedLoader = reloadedManager.getOrCreate(restoredUuid)
    const reloadedTerminal = await waitForLoaderTerminal(reloadedLoader)
    const afterArtifactRestoreLoaderHasData = reloadedLoader.data.nonEmpty()
    const afterArtifactRestoreLoaderHasPeaks = reloadedLoader.peaks.nonEmpty()
    log(`reloaded loader (post artifact restore): state=${reloadedTerminal.type}`
        + ` data=${afterArtifactRestoreLoaderHasData} peaks=${afterArtifactRestoreLoaderHasPeaks}`)
    return {
        peaksAvailableImmediately,
        peakNumFrames,
        peakStageCount,
        dataMaterialized,
        materializedFrames: audio.numberOfFrames,
        fallbackResolved,
        fallbackTerminalState: fallbackTerminal.type,
        fallbackLoaderHasData,
        fallbackLoaderHasPeaks,
        fallbackLoaderIsSameInstanceAfterReload: sameInstance,
        fallbackLoaderAudioFrames,
        afterArtifactRestoreLoaderHasData,
        afterArtifactRestoreLoaderHasPeaks
    }
}

const waitForLoaderTerminal = (
    loader: ReturnType<GlobalSampleLoaderManager["getOrCreate"]>
): Promise<SampleLoaderState> =>
    new Promise(resolve => {
        const subscription = loader.subscribe(state => {
            if (state.type === "loaded" || state.type === "error") {
                queueMicrotask(() => subscription.terminate())
                resolve(state)
            }
        })
    })

export const runPodcastRecordingTest = (config: PodcastRecordingTestConfig): PodcastRecordingTestRunHandle => {
    const events = new Notifier<PodcastRecordingTestEvent>()
    const resultPromise = (async () => {
        const installAttempt = await Promises.tryCatch(installInfrastructureOnce(config.workersUrl, config.workletsUrl))
        if (installAttempt.status === "rejected") {
            return {status: "error", error: installAttempt.error} satisfies PodcastRecordingTestResult
        }
        const runAttempt = await Promises.tryCatch(performRun({...config, events}))
        if (runAttempt.status === "rejected") {
            return {status: "error", error: runAttempt.error} satisfies PodcastRecordingTestResult
        }
        return runAttempt.value
    })()
    return {
        resultPromise,
        subscribeEvents: (observer: Observer<PodcastRecordingTestEvent>): Subscription => events.subscribe(observer)
    }
}

export const cleanAllRecordings = async (): Promise<ReadonlyArray<UUID.String>> => {
    const ids = await LongRecordingStorage.listAll(Workers.Opfs)
    for (const recordingId of ids) {
        await LongRecordingStorage.create(recordingId, Workers.Opfs).delete()
    }
    return ids
}

export const installInfrastructure = installInfrastructureOnce

export interface ResultSummary {
    readonly kind: "pass" | "fail" | "error"
    readonly summary: string
    readonly recordingId: string
}

export const describeResult = (result: PodcastRecordingTestResult): ResultSummary => {
    if (result.status === "pass") {
        return {
            kind: "pass",
            summary: JSON.stringify({
                overall: result.recovery.overall,
                totalFrames: result.manifest.totalFrames,
                chunks: result.manifest.chunks.length,
                overviewBins: result.overviewBinCount,
                requestedSampleRate: result.captureMetadata.requestedSampleRate,
                actualSampleRate: result.captureMetadata.actualSampleRate,
                deviceSampleRate: result.captureMetadata.deviceSampleRate ?? null,
                requestedChannels: result.captureMetadata.requestedChannels,
                actualChannels: result.captureMetadata.actualChannels,
                loaderPeaksImmediate: result.loaderProbe.peaksAvailableImmediately,
                loaderDataMaterialized: result.loaderProbe.dataMaterialized,
                loaderFallbackResolved: result.loaderProbe.fallbackResolved,
                loaderFallbackTerminal: result.loaderProbe.fallbackTerminalState,
                loaderFallbackData: result.loaderProbe.fallbackLoaderHasData,
                loaderFallbackPeaks: result.loaderProbe.fallbackLoaderHasPeaks,
                loaderFallbackSameInstance: result.loaderProbe.fallbackLoaderIsSameInstanceAfterReload,
                loaderFallbackFrames: result.loaderProbe.fallbackLoaderAudioFrames,
                reloadedLoaderData: result.loaderProbe.afterArtifactRestoreLoaderHasData,
                reloadedLoaderPeaks: result.loaderProbe.afterArtifactRestoreLoaderHasPeaks
            }),
            recordingId: result.recordingId
        }
    }
    if (result.status === "fail") {
        return {kind: "fail", summary: result.reason, recordingId: result.recordingId}
    }
    return {kind: "error", summary: String(result.error), recordingId: ""}
}
