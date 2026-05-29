import workersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import workletsUrl from "@opendaw/studio-core/processors.js?url"
import offlineEngineUrl from "@opendaw/studio-core/offline-engine.js?url"
import {
    cleanAllRecordings,
    describeResult,
    PodcastRecordingTestResult,
    runPodcastRecordingTest
} from "./runner"
import {ProductPathTestResult, runProductPathTest} from "./productPathRunner"
import {isDefined} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"

const logEl = document.getElementById("log") as HTMLPreElement
const statusEl = document.getElementById("status") as HTMLSpanElement
const runButton = document.getElementById("run") as HTMLButtonElement
const cleanButton = document.getElementById("clean") as HTMLButtonElement
const durationInput = document.getElementById("duration") as HTMLInputElement
const channelsInput = document.getElementById("channels") as HTMLInputElement
const framesPerChunkInput = document.getElementById("framesPerChunk") as HTMLInputElement
const captureKindSelect = document.getElementById("captureKind") as HTMLSelectElement
const metadataTbody = (document.querySelector("#metadata tbody") as HTMLTableSectionElement)

const log = (message: string): void => {
    const stamp = new Date().toISOString().slice(11, 23)
    logEl.textContent = `${logEl.textContent}\n[${stamp}] ${message}`.trimStart()
    console.debug(`[podcast-test] ${message}`)
    logEl.scrollTop = logEl.scrollHeight
}

const setStatus = (text: string, tone: "ok" | "warn" | "fail" | ""): void => {
    statusEl.textContent = text
    statusEl.classList.remove("ok", "warn", "fail")
    if (tone !== "") {statusEl.classList.add(tone)}
}

const renderMetadata = (rows: ReadonlyArray<readonly [string, string]>): void => {
    metadataTbody.replaceChildren()
    for (const [key, value] of rows) {
        const tr = document.createElement("tr")
        const keyCell = document.createElement("td")
        const valueCell = document.createElement("td")
        keyCell.textContent = key
        keyCell.style.padding = "0.15em 0.75em 0.15em 0"
        keyCell.style.color = "#888"
        valueCell.textContent = value
        valueCell.style.padding = "0.15em 0"
        valueCell.dataset["test"] = `metadata-${key}`
        tr.append(keyCell, valueCell)
        metadataTbody.appendChild(tr)
    }
}

const applyResultStatus = (result: PodcastRecordingTestResult): void => {
    const summary = describeResult(result)
    statusEl.setAttribute("data-test-status", summary.kind)
    logEl.setAttribute("data-test-summary", summary.summary)
    if (summary.recordingId !== "") {logEl.setAttribute("data-test-recording-id", summary.recordingId)}
    if (summary.kind === "pass") {
        setStatus("PASS", "ok")
    } else if (summary.kind === "fail") {
        setStatus("FAIL", "fail")
    } else {
        setStatus("ERROR", "fail")
    }
    if (result.status === "pass") {
        const metadata = result.captureMetadata
        renderMetadata([
            ["source", metadata.kind],
            ["label", metadata.label],
            ["requestedSampleRate", String(metadata.requestedSampleRate)],
            ["actualSampleRate", String(metadata.actualSampleRate)],
            ["deviceSampleRate", isDefined(metadata.deviceSampleRate)
                ? String(metadata.deviceSampleRate)
                : "n/a"],
            ["requestedChannels", String(metadata.requestedChannels)],
            ["actualChannels", String(metadata.actualChannels)],
            ["mismatches", result.mismatches.length === 0 ? "none" : result.mismatches.map(report => report.kind).join(", ")],
            ["recovery", result.recovery.overall],
            ["totalFrames", String(result.manifest.totalFrames)],
            ["chunks", String(result.manifest.chunks.length)],
            ["overviewBins", String(result.overviewBinCount)]
        ])
    }
}

const describeProductResult = (result: ProductPathTestResult): {kind: "pass" | "fail" | "error", summary: string} => {
    if (result.status === "pass") {
        return {kind: "pass", summary: JSON.stringify(result.summary)}
    }
    if (result.status === "fail") {return {kind: "fail", summary: result.reason}}
    return {kind: "error", summary: String(result.error)}
}

const runProductTest = async (): Promise<void> => {
    runButton.disabled = true
    cleanButton.disabled = true
    setStatus("running (product path)", "warn")
    statusEl.setAttribute("data-test-status", "running")
    logEl.removeAttribute("data-test-summary")
    logEl.removeAttribute("data-test-recording-id")
    const handle = runProductPathTest({workersUrl, workletsUrl, offlineEngineUrl})
    handle.subscribeEvents(event => log(`[${event.kind}] ${event.message}`))
    const result = await handle.resultPromise
    log("---")
    const summary = describeProductResult(result)
    log(summary.summary)
    statusEl.setAttribute("data-test-status", summary.kind)
    logEl.setAttribute("data-test-summary", summary.summary)
    if (result.status === "pass") {logEl.setAttribute("data-test-recording-id", result.recordingId)}
    if (summary.kind === "pass") {setStatus("PASS (product path)", "ok")}
    else if (summary.kind === "fail") {setStatus("FAIL (product path)", "fail")}
    else {setStatus("ERROR (product path)", "fail")}
    runButton.disabled = false
    cleanButton.disabled = false
}

const runTest = async (): Promise<void> => {
    runButton.disabled = true
    cleanButton.disabled = true
    setStatus("running", "warn")
    statusEl.setAttribute("data-test-status", "running")
    logEl.removeAttribute("data-test-summary")
    logEl.removeAttribute("data-test-recording-id")
    const duration = Math.max(1, Math.min(600, Number(durationInput.value) || 5))
    const channels = (Math.max(1, Math.min(2, Number(channelsInput.value) || 2))) as 1 | 2
    const framesPerChunk = Math.max(128, Number(framesPerChunkInput.value) || 24000)
    const captureKindRaw = captureKindSelect.value
    const captureKind = captureKindRaw === "getUserMedia" ? "getUserMedia" : "synthetic"
    const handle = runPodcastRecordingTest({
        durationSeconds: duration,
        numberOfChannels: channels,
        framesPerChunk,
        captureKind,
        workersUrl,
        workletsUrl
    })
    handle.subscribeEvents(event => log(`[${event.kind}] ${event.message}`))
    const result = await handle.resultPromise
    log("---")
    log(describeResult(result).summary)
    applyResultStatus(result)
    runButton.disabled = false
    cleanButton.disabled = false
}

const cleanState = async (): Promise<void> => {
    setStatus("cleaning…", "warn")
    const installed = await Promises.tryCatch(import("./runner").then(module =>
        module.installInfrastructure(workersUrl, workletsUrl)))
    if (installed.status === "rejected") {
        log(`infrastructure install failed: ${String(installed.error)}`)
        setStatus("ERROR", "fail")
        return
    }
    const cleanResult = await Promises.tryCatch(cleanAllRecordings())
    if (cleanResult.status === "rejected") {
        log(`clean error: ${String(cleanResult.error)}`)
        setStatus("ERROR", "fail")
        return
    }
    log(`deleted ${cleanResult.value.length} recording(s)`)
    setStatus("cleaned", "ok")
}

runButton.addEventListener("click", () => {
    runTest().catch(reason => log(`unexpected: ${String(reason)}`))
})
cleanButton.addEventListener("click", () => {
    cleanState().catch(reason => log(`unexpected: ${String(reason)}`))
})
log("ready — click 'Start test' to begin, or pass ?autorun=1&duration=N to auto-start")

const params = new URLSearchParams(window.location.search)
if (params.get("autorun") === "1") {
    const mode = params.get("mode") ?? "record"
    const autoDuration = params.get("duration")
    if (isDefined(autoDuration)) {durationInput.value = autoDuration}
    const autoChannels = params.get("channels")
    if (isDefined(autoChannels)) {channelsInput.value = autoChannels}
    const autoFramesPerChunk = params.get("framesPerChunk")
    if (isDefined(autoFramesPerChunk)) {framesPerChunkInput.value = autoFramesPerChunk}
    const autoSource = params.get("source")
    if (autoSource === "getUserMedia" || autoSource === "synthetic") {captureKindSelect.value = autoSource}
    log(`autorun=1 detected (mode=${mode}) — starting test`)
    if (mode === "product") {
        runProductTest().catch(reason => log(`unexpected: ${String(reason)}`))
    } else {
        runTest().catch(reason => log(`unexpected: ${String(reason)}`))
    }
}
