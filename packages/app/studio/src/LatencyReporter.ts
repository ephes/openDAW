import {isDefined, Terminable} from "@opendaw/lib-std"

const STORAGE_KEY = "reported-latencies"
const API_URL = "https://api.opendaw.studio/latency/report.php"
const MAX_MS = 500

const bucketMs = (context: AudioContext): number => {
    const raw = context.outputLatency
    if (!isDefined(raw) || raw === 0) return -1
    return Math.min(MAX_MS, Math.round(raw * 1000))
}

const report = (ms: number): void => {
    const reported: ReadonlyArray<number> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (reported.includes(ms)) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...reported, ms]))
    if (isDefined(navigator.sendBeacon)) {
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
        const ms = bucketMs(context)
        if (ms !== -1) report(ms)
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
