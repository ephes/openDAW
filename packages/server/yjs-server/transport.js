import {WebSocketServer} from 'ws'
import {setupWSConnection} from './utils.js'
import {isAllowedOrigin, SIGNALING_MAX_PAYLOAD, MAX_TOPIC_BYTES, MAX_SUBSCRIPTIONS, sendBounded} from './policy.js'

const validTopic = topic => typeof topic === 'string' && topic.length > 0 && Buffer.byteLength(topic) <= MAX_TOPIC_BYTES
const validTopics = topics => Array.isArray(topics) && topics.length <= MAX_SUBSCRIPTIONS && topics.every(validTopic)

// Attaching to an existing HTTP(S) server also allows certificate-free local tests.
export const attachCollaboration = server => {
    const wss = new WebSocketServer({noServer: true})
    wss.on('connection', setupWSConnection)
    const signalingWss = new WebSocketServer({noServer: true, maxPayload: SIGNALING_MAX_PAYLOAD})
    const rooms = new Map()

    signalingWss.on('connection', conn => {
        const subscribedTopics = new Set()
        let closed = false
        const unsubscribe = topic => {
            subscribedTopics.delete(topic)
            const subscribers = rooms.get(topic)
            if (subscribers) {
                subscribers.delete(conn)
                // Signaling has no retained room state: retire empty topics immediately,
                // bounding churn as well as active subscriptions without cleanup timers.
                if (subscribers.size === 0) {rooms.delete(topic)}
            }
        }
        const cleanup = () => {
            if (closed) {return}
            closed = true
            for (const topic of subscribedTopics) {unsubscribe(topic)}
        }
        const reject = () => {
            cleanup()
            conn.close(1008, 'Invalid signaling message')
        }
        conn.on('message', data => {
            if (closed) {return}
            let message
            try {message = JSON.parse(data.toString())} catch {reject(); return}
            if (message === null || typeof message !== 'object') {reject(); return}
            switch (message.type) {
                case 'subscribe': {
                    if (!validTopics(message.topics)
                        || new Set([...subscribedTopics, ...message.topics]).size > MAX_SUBSCRIPTIONS) {
                        reject(); return
                    }
                    for (const topic of message.topics) {
                        subscribedTopics.add(topic)
                        const subscribers = rooms.get(topic) ?? new Set()
                        subscribers.add(conn)
                        rooms.set(topic, subscribers)
                    }
                    break
                }
                case 'unsubscribe': {
                    if (!validTopics(message.topics)) {reject(); return}
                    for (const topic of message.topics) {unsubscribe(topic)}
                    break
                }
                case 'publish': {
                    if (!validTopic(message.topic)) {reject(); return}
                    const subscribers = rooms.get(message.topic)
                    const forward = JSON.stringify(message)
                    if (subscribers) {
                        for (const subscriber of subscribers) {
                            if (subscriber !== conn) {
                                // The close event owns that peer's room cleanup.
                                sendBounded(subscriber, forward, () => subscriber.close())
                            }
                        }
                    }
                    break
                }
                case 'ping':
                    sendBounded(conn, JSON.stringify({type: 'pong'}), cleanup)
                    break
                default: reject()
            }
        })
        conn.on('close', cleanup)
        conn.on('error', () => {cleanup(); conn.terminate()})
    })

    server.on('upgrade', (req, socket, head) => {
        if (!isAllowedOrigin(req.headers.origin)) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            return
        }
        const target = (req.url || '/').startsWith('/signaling') ? signalingWss : wss
        target.handleUpgrade(req, socket, head, conn => target.emit('connection', conn, req))
    })
    return {wss, signalingWss, rooms}
}
