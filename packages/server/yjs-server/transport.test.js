import {afterEach, expect, it, vi} from 'vitest'
import {EventEmitter, once} from 'node:events'
import http from 'node:http'
import {WebSocket} from 'ws'
import * as Y from 'yjs'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import {attachCollaboration} from './transport.js'
import {WSSharedDoc, docs, setupWSConnection} from './utils.js'
import {callbackHandler} from './callback.js'
import {MAX_OUTBOUND_BYTES, MAX_SUBSCRIPTIONS, MAX_TOPIC_BYTES, SIGNALING_MAX_PAYLOAD} from './policy.js'

vi.mock('lib0/time', async importOriginal => ({...await importOriginal(), getUnixTime: () => Date.now()}))
vi.mock('./callback.js', () => ({isCallbackSet: true, callbackHandler: vi.fn()}))

class Peer extends EventEmitter {
    readyState = WebSocket.OPEN
    bufferedAmount = 0
    send = vi.fn((_data, ...args) => {const callback = args.at(-1); if (typeof callback === 'function') {callback()}})
    ping = vi.fn()
    close = vi.fn(() => {if (this.readyState !== WebSocket.CLOSED) {this.readyState = WebSocket.CLOSED; this.emit('close')}})
    terminate = vi.fn(() => this.close())
    message(value) {this.emit('message', Buffer.from(JSON.stringify(value)))}
}
const resources = []
afterEach(async () => {
    for (const close of resources.splice(0)) {await close()}
    for (const doc of docs.values()) {doc.destroy()}
    docs.clear()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
})
const fixture = () => {
    const server = http.createServer()
    const transport = attachCollaboration(server)
    resources.push(async () => {transport.wss.close(); transport.signalingWss.close()})
    const connect = () => {
        const peer = new Peer()
        transport.signalingWss.emit('connection', peer, {headers: {}})
        return peer
    }
    return {...transport, server, connect}
}

it('debounces callbacks independently for each document and cancels on destruction', () => {
    vi.useFakeTimers()
    const a = new WSSharedDoc('A')
    const b = new WSSharedDoc('B')
    a.getMap('data').set('value', 1)
    vi.advanceTimersByTime(1000)
    b.getMap('data').set('value', 2)
    a.getMap('data').set('value', 3)
    vi.advanceTimersByTime(2000)
    expect(callbackHandler.mock.calls.map(([doc]) => [doc.name, doc.getMap('data').get('value')])).toEqual([['B', 2], ['A', 3]])
    a.getMap('data').set('value', 4)
    a.destroy()
    vi.advanceTimersByTime(2000)
    expect(callbackHandler).toHaveBeenCalledTimes(2)
    b.destroy()
})
it('retains the configured debounce max-wait behavior per document', () => {
    vi.useFakeTimers()
    const doc = new WSSharedDoc('max-wait')
    for (let i = 0; i < 9; i++) {
        doc.getMap('data').set('value', i)
        vi.advanceTimersByTime(1500)
    }
    expect(callbackHandler).toHaveBeenCalled()
    expect(callbackHandler.mock.calls.every(([value]) => value === doc)).toBe(true)
    doc.destroy()
})

for (const topics of [[1], [{}], ['x'.repeat(MAX_TOPIC_BYTES + 1)], ['ok', {}], Array.from({length: MAX_SUBSCRIPTIONS + 1}, (_, i) => `t${i}`)]) {
    it(`rejects malformed subscription batch ${JSON.stringify(topics).slice(0, 60)} atomically`, () => {
        const {rooms, connect} = fixture()
        const peer = connect()
        const set = vi.spyOn(rooms, 'set')
        peer.message({type: 'subscribe', topics})
        expect(rooms.size).toBe(0)
        expect(set).not.toHaveBeenCalled()
        expect(peer.close).toHaveBeenCalledWith(1008, 'Invalid signaling message')
    })
}
it('bounds unique subscriptions, repeated requests and empty-room churn', () => {
    const {rooms, connect} = fixture()
    const peer = connect()
    for (let i = 0; i < 100; i++) {
        const topic = `temporary-${i}`
        peer.message({type: 'subscribe', topics: [topic, topic]})
        expect(rooms.size).toBe(1)
        peer.message({type: 'unsubscribe', topics: [topic]})
        expect(rooms.size).toBe(0)
    }
    peer.message({type: 'subscribe', topics: Array.from({length: MAX_SUBSCRIPTIONS}, (_, i) => `t${i}`)})
    expect(rooms.size).toBe(MAX_SUBSCRIPTIONS)
    peer.message({type: 'subscribe', topics: ['extra']})
    expect(peer.close).toHaveBeenCalledWith(1008, 'Invalid signaling message')
    expect(rooms.size).toBe(0)
})
it('removes a slow signaling peer while healthy peers receive ordered publications', () => {
    const {rooms, connect} = fixture()
    const publisher = connect(), slow = connect(), healthy = connect()
    for (const peer of [slow, healthy]) {peer.message({type: 'subscribe', topics: ['room']})}
    slow.bufferedAmount = MAX_OUTBOUND_BYTES
    for (const value of [1, 2]) {publisher.message({type: 'publish', topic: 'room', value})}
    expect(slow.send).not.toHaveBeenCalled()
    expect(slow.terminate).toHaveBeenCalledOnce()
    expect(rooms.get('room').has(slow)).toBe(false)
    expect(healthy.send.mock.calls.map(([text]) => JSON.parse(text).value)).toEqual([1, 2])
    healthy.close()
    expect(rooms.size).toBe(0)
})
it('closes peers before a queued message crosses the outbound threshold', () => {
    const {connect} = fixture()
    const peer = connect()
    peer.bufferedAmount = MAX_OUTBOUND_BYTES - 1
    peer.message({type: 'ping'})
    expect(peer.send).not.toHaveBeenCalled()
    expect(peer.terminate).toHaveBeenCalledOnce()
})
it('removes a slow Yjs peer and its awareness while a healthy peer continues', () => {
    vi.useFakeTimers()
    const slow = new Peer(), healthy = new Peer()
    setupWSConnection(slow, {headers: {}, url: '/room'})
    setupWSConnection(healthy, {headers: {}, url: '/room'})
    const doc = docs.get('room')
    doc.awareness.states.set(42, {name: 'synthetic'})
    doc.awareness.meta.set(42, {clock: 0, lastUpdated: Date.now()})
    doc.conns.get(slow).add(42)
    slow.send.mockClear()
    healthy.send.mockClear()
    slow.bufferedAmount = MAX_OUTBOUND_BYTES
    doc.getMap('data').set('value', 1)
    doc.getMap('data').set('value', 2)
    expect(slow.send).not.toHaveBeenCalled()
    expect(slow.terminate).toHaveBeenCalled()
    expect(doc.conns.has(slow)).toBe(false)
    expect(doc.awareness.getStates().has(42)).toBe(false)
    expect(healthy.send.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Apply actual sync updates received by the healthy peer in order.
    const replica = new Y.Doc()
    const sync = healthy.send.mock.calls.map(([message]) => message).filter(message => message[0] === 0)
    expect(sync.length).toBe(2)
    const values = []
    for (const message of sync) {
        const decoder = decoding.createDecoder(message)
        decoding.readVarUint(decoder)
        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), replica, null)
        values.push(replica.getMap('data').get('value'))
    }
    expect(values).toEqual([1, 2])
    replica.destroy()
    healthy.close()
    vi.advanceTimersByTime(60_000)
    expect(docs.has('room')).toBe(false)
})

const listen = async () => {
    const state = fixture()
    state.server.listen(0, '127.0.0.1')
    await once(state.server, 'listening')
    const clients = []
    resources.unshift(async () => {
        for (const client of clients) {client.terminate()}
        for (const conn of [...state.wss.clients, ...state.signalingWss.clients]) {conn.terminate()}
        await new Promise(resolve => state.server.close(resolve))
    })
    const socket = (path, origin) => {
        const client = new WebSocket(`ws://127.0.0.1:${state.server.address().port}${path}`, origin === undefined ? {} : {origin})
        client.on('error', () => {})
        clients.push(client)
        return client
    }
    return {...state, socket}
}
for (const path of ['/signaling', '/synthetic-doc']) {
    for (const origin of ['https://opendaw.studio', undefined, 'https://foreign.invalid']) {
        it(`authorizes ${path} origin=${origin} before allocating a connection`, async () => {
            const {socket, signalingWss, wss, rooms} = await listen()
            const peer = socket(path, origin)
            if (origin === 'https://foreign.invalid') {
                const [, response] = await once(peer, 'unexpected-response')
                expect(response.statusCode).toBe(403)
                expect(signalingWss.clients.size + wss.clients.size).toBe(0)
                expect(rooms.size).toBe(0)
                expect(docs.has('synthetic-doc')).toBe(false)
            } else {
                await once(peer, 'open')
                expect(signalingWss.clients.size + wss.clients.size).toBe(1)
            }
        })
    }
}
it('enforces signaling ingress bytes with real ws sockets, separately from Yjs', async () => {
    const {socket, signalingWss, wss, rooms} = await listen()
    expect(signalingWss.options.maxPayload).toBe(SIGNALING_MAX_PAYLOAD)
    expect(wss.options.maxPayload).toBeGreaterThan(SIGNALING_MAX_PAYLOAD)
    const peer = socket('/signaling', 'https://opendaw.studio')
    await once(peer, 'open')
    const closing = once(peer, 'close')
    peer.send('x'.repeat(SIGNALING_MAX_PAYLOAD + 1))
    expect((await closing)[0]).toBe(1009)
    expect(rooms.size).toBe(0)
})
it('normal signaling publications and ping/pong work on loopback sockets', async () => {
    const {socket} = await listen()
    const subscriber = socket('/signaling'), publisher = socket('/signaling')
    await Promise.all([once(subscriber, 'open'), once(publisher, 'open')])
    subscriber.send(JSON.stringify({type: 'subscribe', topics: ['room']}))
    subscriber.send(JSON.stringify({type: 'ping'}))
    const [pong] = await once(subscriber, 'message')
    expect(JSON.parse(pong).type).toBe('pong')
    const received = once(subscriber, 'message')
    publisher.send(JSON.stringify({type: 'publish', topic: 'room', value: 'synthetic'}))
    expect(JSON.parse((await received)[0]).value).toBe('synthetic')
})

for (const path of ['/signaling', '/room']) {
    it(`rejects foreign upgrades on ${path} before handleUpgrade`, () => {
        const {server, wss, signalingWss} = fixture()
        const socket = {end: vi.fn()}
        vi.spyOn(wss, 'handleUpgrade').mockImplementation(() => {})
        vi.spyOn(signalingWss, 'handleUpgrade').mockImplementation(() => {})
        server.emit('upgrade', {url: path, headers: {origin: 'https://foreign.invalid'}}, socket, Buffer.alloc(0))
        expect(wss.handleUpgrade).not.toHaveBeenCalled()
        expect(signalingWss.handleUpgrade).not.toHaveBeenCalled()
        expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'))
    })
}
