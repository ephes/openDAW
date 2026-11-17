import {Terminable} from "@opendaw/lib-std"

const STORAGE_KEY = "reported-latencies"
const API_URL = "https://api.opendaw.studio/latency/report.php"
const MAX_MS = 500

const bucketMs = (context: AudioContext): number => {
    const raw = context.outputLatency
    if (!Number.isFinite(raw) || raw <= 0) return -1
    return Math.min(MAX_MS, Math.round(raw * 1000))
}

const report = (ms: number): void => {
    const raw = localStorage.getItem(STORAGE_KEY) ?? "[]"
    if (raw.length > 4096) {throw new Error("Invalid latency history")}
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > MAX_MS + 1 || !parsed.every(value =>
        typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_MS)) {
        throw new Error("Invalid latency history")
    }
    const reported = Array.from(new Set<number>(parsed))
    if (reported.includes(ms)) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...reported, ms]))
    if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(API_URL, JSON.stringify({latency: ms}))
    }
}

const reporters = new WeakMap<AudioContext, Terminable>()

export const installLatencyReporter = (context: AudioContext): Terminable => {
    const installed = reporters.get(context)
    if (installed !== undefined) {return installed}
    if (context.state === "closed") {return Terminable.Empty}
    const check = () => {
        if (context.state !== "running") return
        try {
            const ms = bucketMs(context)
            if (ms !== -1) {report(ms)}
        } catch {
            // Reporting is optional. Storage/beacon refusal must not reach the app error path.
            handle.terminate()
        }
    }
    const timer = setInterval(check, 10_000)
    let active = true
    const handle: Terminable = {
        terminate: () => {
            if (!active) {return}
            active = false
            clearInterval(timer)
            context.removeEventListener("statechange", onStateChange)
            reporters.delete(context)
        }
    }
    const onStateChange = () => {if (context.state === "closed") {handle.terminate()}}
    context.addEventListener("statechange", onStateChange)
    reporters.set(context, handle)
    return handle
}
