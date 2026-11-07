import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {EventEmitter} from 'node:events'
import http from 'node:http'
import https from 'node:https'
import * as Y from 'yjs'

let requests
const document = (name = 'synthetic-room', value = 'first') => {
    const doc = new Y.Doc()
    doc.name = name
    doc.getMap('map').set('value', value)
    return doc
}
const response = (request, status = 204) => {
    const incoming = new EventEmitter()
    incoming.statusCode = status
    incoming.destroy = vi.fn()
    request.emit('response', incoming)
    return incoming
}
const finish = request => response(request).emit('end')
const load = async (env = {}) => {
    Object.entries({CALLBACK_URL: 'https://sink.example/hook?key=invented', CALLBACK_OBJECTS: '{"map":"Map"}', ...env})
        .forEach(([key, value]) => vi.stubEnv(key, value))
    return import('./callback.js')
}
beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    requests = []
    const request = options => {
        const req = new EventEmitter()
        req.options = options
        req.payload = ''
        req.write = vi.fn(data => {req.payload += data})
        req.end = vi.fn(data => {if (data) {req.payload += data}})
        req.destroy = vi.fn()
        req.abort = req.destroy
        requests.push(req)
        return req
    }
    vi.spyOn(http, 'request').mockImplementation(request)
    vi.spyOn(https, 'request').mockImplementation(request)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks()})

describe('callback startup configuration', () => {
    it.each(['', 'https://sink.example/'])('retains empty setting defaults with URL=%s', async url => {
        const {callbackHandler, isCallbackSet} = await load({CALLBACK_URL: url, CALLBACK_TIMEOUT: '', CALLBACK_OBJECTS: ''})
        expect(isCallbackSet).toBe(url !== '')
        callbackHandler(document())
        expect(requests).toHaveLength(url === '' ? 0 : 1)
        if (url !== '') {
            expect(JSON.parse(requests[0].payload).data).toEqual({})
            finish(requests[0])
        }
        expect(vi.getTimerCount()).toBe(0)
    })
    it.each(['[]', 'null', '{', '{"x":"Unknown"}', '{"x":3}', '{"":"Map"}'])(
        'rejects invalid objects %s', async value => {
            await expect(load({CALLBACK_OBJECTS: value})).rejects.toThrow(/CALLBACK_OBJECTS/)
            expect(requests).toHaveLength(0)
        })
    it.each(['0', '-1', '1.5', '12junk', 'Infinity', '2147483648', '300001'])(
        'rejects invalid timeout %s', async value => {
            await expect(load({CALLBACK_TIMEOUT: value})).rejects.toThrow(/CALLBACK_TIMEOUT/)
        })
    it.each(['ftp://sink.example/', 'not-a-url'])(
        'rejects unsupported URLs safely', async value => {
            await expect(load({CALLBACK_URL: value})).rejects.toThrow('Invalid CALLBACK_URL')
        })
    it('serializes every supported Yjs accessor', async () => {
        const {callbackHandler} = await load({CALLBACK_OBJECTS: JSON.stringify({array: 'Array', map: 'Map', text: 'Text', fragment: 'XmlFragment', element: 'XmlElement'})})
        const doc = document()
        doc.getArray('array').push([1, 2])
        doc.getText('text').insert(0, 'invented')
        callbackHandler(doc)
        const payload = JSON.parse(requests[0].payload)
        expect(payload.data.map.content).toEqual({value: 'first'})
        expect(payload.data.array.content).toEqual([1, 2])
        expect(payload.data.text.content).toBe('invented')
        expect(Object.keys(payload.data)).toHaveLength(5)
        finish(requests[0])
    })
})

describe('callback transport and terminal paths', () => {
    it('uses standard URL options for IPv6 literals', async () => {
        const {callbackHandler} = await load({CALLBACK_URL: 'http://[::1]:8080/hook?x=1'})
        callbackHandler(document())
        expect(requests[0].options.hostname).toBe('::1')
        expect(requests[0].options.path).toBe('/hook?x=1')
        finish(requests[0])
    })
    it.each(['http', 'https'])('uses %s with exact path/query and byte length', async scheme => {
        const {callbackHandler} = await load({CALLBACK_URL: `${scheme}://sink.example:8443/hook?key=invented&x=2`})
        callbackHandler(document('synthetic', 'ö'))
        expect((scheme === 'https' ? https : http).request).toHaveBeenCalledTimes(1)
        const req = requests[0]
        expect(req.options.path).toBe('/hook?key=invented&x=2')
        expect(req.options.port).toBe(8443)
        expect(req.options.headers['Content-Length']).toBe(Buffer.byteLength(req.payload))
        finish(req)
        expect(vi.getTimerCount()).toBe(0)
    })
    it.each(['status', 'oversize', 'timeout', 'error', 'aborted', 'close'])(
        'settles %s once, frees admission and emits safe diagnostics', async mode => {
            const {callbackHandler} = await load()
            const doc = document()
            callbackHandler(doc)
            const req = requests[0]
            callbackHandler(doc)
            expect(requests).toHaveLength(1)
            if (mode === 'error') {req.emit('error', new Error('private ?key=invented'))}
            else {
                const incoming = response(req, mode === 'status' ? 500 : 200)
                if (mode === 'oversize') {incoming.emit('data', Buffer.alloc(65537))}
                if (mode === 'timeout') {
                    for (let index = 0; index < 5; index++) {vi.advanceTimersByTime(999); incoming.emit('data', Buffer.alloc(1))}
                    vi.advanceTimersByTime(5)
                }
                if (mode === 'aborted') {incoming.emit('aborted')}
                if (mode === 'close') {incoming.emit('close')}
            }
            expect(req.destroy).toHaveBeenCalledTimes(1)
            expect(requests).toHaveLength(2)
            req.emit('error', new Error('late private ?key=invented'))
            expect(requests).toHaveLength(2)
            finish(requests[1])
            expect(vi.getTimerCount()).toBe(0)
            expect(JSON.stringify(console.warn.mock.calls)).not.toContain('invented')
            expect(JSON.stringify(console.error.mock.calls)).not.toContain('invented')
        })
})

describe('callback admission', () => {
    it('caps inflight work and delivers only the latest pending snapshot per room', async () => {
        const {callbackHandler} = await load()
        const docs = Array.from({length: 8}, (_, index) => document(`room-${index}`))
        docs.forEach(doc => callbackHandler(doc))
        expect(requests).toHaveLength(4)
        docs.forEach(doc => {doc.getMap('map').set('value', 'latest'); callbackHandler(doc)})
        for (let index = 0; index < requests.length; index++) {finish(requests[index])}
        const payloads = requests.map(req => JSON.parse(req.payload))
        for (const doc of docs) {
            const deliveries = payloads.filter(payload => payload.room === doc.name)
            expect(deliveries.at(-1).data.map.content.value).toBe('latest')
            expect(deliveries.length).toBeLessThanOrEqual(2)
        }
        expect(vi.getTimerCount()).toBe(0)
    })
    it('bounds pending rooms and outbound payloads', async () => {
        const {callbackHandler} = await load()
        callbackHandler(document('too-large', 'x'.repeat(1024 * 1024)))
        expect(requests).toHaveLength(0)
        for (let index = 0; index < 100; index++) {callbackHandler(document(`room-${index}`))}
        expect(requests).toHaveLength(4)
        for (let index = 0; index < requests.length; index++) {finish(requests[index])}
        expect(requests).toHaveLength(36)
        expect(vi.getTimerCount()).toBe(0)
    })
})
