import workersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import workletsUrl from "@opendaw/studio-core/processors.js?url"
import {
    AudioWorklets,
    CaptureSourceMetadata,
    LongRecordingChunkBuffer,
    LongRecordingMediaAccess,
    LongRecordingMediaReference,
    LongRecordingRecovery,
    LongRecordingSession,
    LongRecordingStorage,
    SyntheticCaptureSource,
    Workers
} from "@opendaw/studio-core"
import {UUID} from "@opendaw/lib-std"

const logEl = document.getElementById("log") as HTMLPreElement
const statusEl = document.getElementById("status") as HTMLSpanElement
const runButton = document.getElementById("run") as HTMLButtonElement
const cleanButton = document.getElementById("clean") as HTMLButtonElement
const durationInput = document.getElementById("duration") as HTMLInputElement
const channelsInput = document.getElementById("channels") as HTMLInputElement
const framesPerChunkInput = document.getElementById("framesPerChunk") as HTMLInputElement

let booted = false

const log = (message: string): void => {
    const stamp = new Date().toISOString().slice(11, 23)
    logEl.textContent = `${logEl.textContent}\n[${stamp}] ${message}`.trimStart()
    console.debug(`[podcast-test] ${message}`)
    logEl.scrollTop = logEl.scrollHeight
}

const setStatus = (text: string, tone: "ok" | "warn" | "fail" | "" = ""): void => {
    statusEl.textContent = text
    statusEl.classList.remove("ok", "warn", "fail")
    if (tone !== "") {statusEl.classList.add(tone)}
}

const ensureBoot = async (): Promise<void> => {
    if (booted) {return}
    setStatus("booting…")
    log("installing OPFS worker + worklet module")
    await Workers.install(workersUrl)
    AudioWorklets.install(workletsUrl)
    booted = true
}

const requestPersistence = async (): Promise<boolean> => {
    const granted = await LongRecordingSession.requestPersistence()
    log(`navigator.storage.persist(): ${granted}`)
    return granted
}

const cleanState = async (): Promise<void> => {
    await ensureBoot()
    const ids = await LongRecordingStorage.listAll(Workers.Opfs)
    if (ids.length === 0) {
        log("OPFS is already clean (no recordings)")
        setStatus("clean", "ok")
        return
    }
    for (const recordingId of ids) {
        await LongRecordingStorage.create(recordingId, Workers.Opfs).delete()
        log(`deleted ${recordingId}`)
    }
    setStatus("cleaned", "ok")
}

const runTest = async (): Promise<void> => {
    runButton.disabled = true
    cleanButton.disabled = true
    setStatus("running", "warn")
    try {
        await ensureBoot()
        LongRecordingSession.assertOpfsSupported()
        await requestPersistence()
        const duration = Math.max(1, Math.min(600, Number(durationInput.value) || 5))
        const channels = Math.max(1, Math.min(2, Number(channelsInput.value) || 2)) as 1 | 2
        const framesPerChunk = Math.max(128, Number(framesPerChunkInput.value) || 24000)
        const context = new AudioContext({sampleRate: 48000, latencyHint: 0})
        log(`AudioContext sampleRate=${context.sampleRate}, state=${context.state}`)
        const worklets = await AudioWorklets.createFor(context)
        if (context.state === "suspended") {await context.resume()}
        const recordingId = UUID.asString(crypto.randomUUID())
        log(`recording id: ${recordingId}`)
        const storage = LongRecordingStorage.create(recordingId, Workers.Opfs)
        const captureSource = new SyntheticCaptureSource({
            context,
            numberOfChannels: channels,
            label: `oscillator-${channels}ch-${duration}s`
        })
        for (const mismatch of CaptureSourceMetadata.mismatches(captureSource.metadata)) {
            log(`capture-source warning: ${mismatch.message}`)
        }
        log(`capture-source metadata: ${JSON.stringify(captureSource.metadata)}`)
        const session = new LongRecordingSession({
            storage,
            sampleRate: context.sampleRate,
            numberOfChannels: channels,
            framesPerChunk,
            source: CaptureSourceMetadata.toLongRecordingSource(captureSource.metadata)
        })
        session.subscribeProgress(progress => {
            log(`progress: frames=${progress.frames} chunks=${progress.chunks} bytes=${progress.bytes} elapsed=${progress.elapsedSeconds.toFixed(2)}s`)
        })
        session.subscribeState(state => log(`session state -> ${state}`))
        session.subscribeStorageErrors(error => log(`STORAGE ERROR: ${String(error)}`))
        await session.arm()
        const worklet = worklets.createLongRecording(session, channels)
        captureSource.outputNode.connect(worklet)
        log(`capture-source connected — recording for ${duration}s`)
        await new Promise(resolve => setTimeout(resolve, duration * 1000))
        captureSource.outputNode.disconnect()
        captureSource.terminate()
        worklet.disconnect()
        await session.stop()
        worklet.terminate()
        await context.close()
        const reloaded = (await storage.readManifest()).unwrap("manifest missing after stop")
        const probes = await storage.listChunkProbes()
        const report = LongRecordingRecovery.classify(reloaded, probes)
        log("---")
        log(`manifest.state = ${reloaded.state}`)
        log(`manifest.totalFrames = ${reloaded.totalFrames}`)
        log(`manifest.chunks = ${reloaded.chunks.length}`)
        log(`probes = ${probes.length}`)
        log(`overall = ${report.overall}`)
        const expectedFrames = duration * context.sampleRate
        const driftFrames = Math.abs(reloaded.totalFrames - expectedFrames)
        const driftMs = (driftFrames / context.sampleRate) * 1000
        log(`expected ~${expectedFrames} frames; got ${reloaded.totalFrames}; drift ${driftFrames} (${driftMs.toFixed(1)}ms)`)
        if (report.overall === "clean" && driftFrames < context.sampleRate * 0.5) {
            setStatus("PASS", "ok")
            log("---\nPASS")
            const sample = await storage.readChunk(0)
            const first = LongRecordingChunkBuffer.deinterleave(sample, channels, Math.min(reloaded.chunks[0].frames, 8))
            log(`first chunk preview ch0: [${Array.from(first[0]).slice(0, 8).map(v => v.toFixed(3)).join(", ")}]`)
            const reference = LongRecordingMediaReference.fromManifest(reloaded)
            log(`media reference: ${JSON.stringify({
                durationSeconds: Number(reference.durationSeconds.toFixed(3)),
                framesPerChunk: reference.framesPerChunk,
                overviewSamplesPerBin: reference.overviewSamplesPerBin
            })}`)
            const access = LongRecordingMediaAccess.create(reference, storage)
            const bins = await access.readOverviewBins()
            log(`overview bins read without loading raw audio: ${bins.length}`)
        } else {
            setStatus("FAIL", "fail")
            log("---\nFAIL")
        }
        logEl.dataset["status"] = report.overall
    } catch (error) {
        setStatus("ERROR", "fail")
        log(`ERROR: ${String(error)}`)
        console.error(error)
    } finally {
        runButton.disabled = false
        cleanButton.disabled = false
    }
}

runButton.addEventListener("click", runTest)
cleanButton.addEventListener("click", () => cleanState().catch(error => log(`clean error: ${String(error)}`)))
log("ready — click 'Start test' to begin")
