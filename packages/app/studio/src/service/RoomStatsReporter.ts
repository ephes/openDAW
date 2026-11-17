import {UUID} from "@opendaw/lib-std"

export type RoomResultStatus = "success" | "sync_timeout" | "socket_error" | "abort" | "unknown"

const ENDPOINT = "https://api.opendaw.studio/rooms/room-counter.php"

export const newRoomSessionId = (): string => UUID.toString(UUID.generate())

export const reportRoomResult = (sessionId: string, status: RoomResultStatus): void => {
    void fetch(ENDPOINT, {
        method: "POST",
        mode: "cors",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action: "result", sessionId, status})
    }).catch(() => {})
}

export const reportRoomDuration = (sessionId: string, durationMinutes: number): void => {
    if (durationMinutes <= 0) {return}
    const body = JSON.stringify({action: "ended", sessionId, durationMinutes})
    try {
        if (typeof navigator.sendBeacon === "function"
            && navigator.sendBeacon(ENDPOINT, new Blob([body], {type: "application/json"}))) {return}
    } catch { /* Refused beacon admission uses the same keepalive fallback. */ }
    void fetch(ENDPOINT, {
        method: "POST",
        mode: "cors",
        headers: {"Content-Type": "application/json"},
        body,
        keepalive: true
    }).catch(() => {})
}

const HEARTBEAT_MS = 60_000

export type RoomDurationHeartbeat = { finalize: () => void, pause: () => void, resume: () => void }

export const startRoomDurationHeartbeat = (sessionId: string): RoomDurationHeartbeat => {
    let lastTickAt = performance.now()
    let remainingMs = 0
    let finalized = false
    let paused = false
    let interval: ReturnType<typeof setInterval>
    const account = () => {
        const now = performance.now()
        remainingMs += Math.max(0, now - lastTickAt)
        lastTickAt = now
    }
    const flushWholeMinutes = () => {
        const minutes = Math.floor(remainingMs / HEARTBEAT_MS)
        remainingMs -= minutes * HEARTBEAT_MS
        reportRoomDuration(sessionId, minutes)
    }
    const tick = () => {
        if (finalized || paused) {return}
        account()
        flushWholeMinutes()
    }
    interval = setInterval(tick, HEARTBEAT_MS)
    return {
        pause: () => {
            if (finalized || paused) {return}
            account()
            paused = true
            clearInterval(interval)
            flushWholeMinutes()
        },
        resume: () => {
            if (finalized || !paused) {return}
            paused = false
            lastTickAt = performance.now()
            interval = setInterval(tick, HEARTBEAT_MS)
        },
        finalize: () => {
            if (finalized) {return}
            finalized = true
            clearInterval(interval)
            if (!paused) {account()}
            reportRoomDuration(sessionId, Math.round(remainingMs / HEARTBEAT_MS))
            remainingMs = 0
        }
    }
}
