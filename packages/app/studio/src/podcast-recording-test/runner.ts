import {Notifier, Observer, Subscription, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {
    AudioWorklets,
    CaptureSource,
    CaptureSourceMetadata,
    ChunkProbe,
    GetUserMediaCaptureSource,
    LongRecordingChunkBuffer,
    LongRecordingManifest,
    LongRecordingMediaAccess,
    LongRecordingMediaReference,
    LongRecordingOverviewBin,
    LongRecordingRecovery,
    LongRecordingRecoveryReport,
    LongRecordingService,
    LongRecordingSession,
    LongRecordingStorage,
    SyntheticCaptureSource,
    Workers
} from "@opendaw/studio-core"

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
    if (config.captureSourceFactory !== undefined) {
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
            recovery: LongRecordingRecovery.classify(session.manifest, []),
            manifest: session.manifest
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
        elapsedFramesDriftFrames: driftFrames
    }
}

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
                requestedChannels: result.captureMetadata.requestedChannels,
                actualChannels: result.captureMetadata.actualChannels
            }),
            recordingId: result.recordingId
        }
    }
    if (result.status === "fail") {
        return {kind: "fail", summary: result.reason, recordingId: result.recordingId}
    }
    return {kind: "error", summary: String(result.error), recordingId: ""}
}
