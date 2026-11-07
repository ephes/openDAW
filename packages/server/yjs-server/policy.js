// Browser Origin is an ingress policy, not room authentication. Origin-less
// requests are allowed for supported native/non-browser WebSocket clients.
export const allowedOrigins = [
    'https://opendaw.studio',
    'https://dev.opendaw.studio',
    'https://live.opendaw.studio',
    'https://localhost:8080',
    'https://inspector.yjs.dev'
]
export const isAllowedOrigin = origin => origin === undefined || allowedOrigins.includes(origin)
export const SIGNALING_MAX_PAYLOAD = 16 * 1024
export const MAX_TOPIC_BYTES = 256
export const MAX_SUBSCRIPTIONS = 32
export const MAX_OUTBOUND_BYTES = 8 * 1024 * 1024

// Use ws's public state and accounting; remove slow peers through their existing
// room cleanup before terminating the socket to release queued bytes immediately.
export const sendBounded = (conn, message, cleanup) => {
    const fail = () => {
        cleanup()
        conn.terminate()
    }
    const size = typeof message === 'string' ? Buffer.byteLength(message) : message.byteLength
    if (conn.readyState !== 1 || conn.bufferedAmount + size > MAX_OUTBOUND_BYTES) {
        fail()
        return
    }
    try {
        conn.send(message, error => {if (error) {fail()}})
    } catch {
        fail()
    }
}
