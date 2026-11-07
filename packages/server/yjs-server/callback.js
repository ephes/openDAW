import http from 'node:http'
import https from 'node:https'
import {urlToHttpOptions} from 'node:url'

const invalid = name => {throw new Error(`Invalid ${name}`)}
const parseURL = value => {
    if (!value) {return null}
    let url
    try {url = new URL(value)} catch {return invalid('CALLBACK_URL')}
    if (!['http:', 'https:'].includes(url.protocol)) {return invalid('CALLBACK_URL')}
    return url
}
const parseTimeout = value => {
    if (!/^\d+$/.test(value)) {return invalid('CALLBACK_TIMEOUT')}
    const timeout = Number(value)
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 300000) {return invalid('CALLBACK_TIMEOUT')}
    return timeout
}
const accessors = Object.freeze({Array: 'getArray', Map: 'getMap', Text: 'getText', XmlFragment: 'getXmlFragment', XmlElement: 'getXmlElement'})
const parseObjects = value => {
    let objects
    try {objects = JSON.parse(value)} catch {return invalid('CALLBACK_OBJECTS')}
    if (objects === null || typeof objects !== 'object' || Array.isArray(objects)
        || Object.entries(objects).some(([name, type]) => name.length === 0 || typeof type !== 'string' || !Object.hasOwn(accessors, type))) {
        return invalid('CALLBACK_OBJECTS')
    }
    return objects
}
const CALLBACK_URL = parseURL(process.env.CALLBACK_URL)
const CALLBACK_TIMEOUT = parseTimeout(process.env.CALLBACK_TIMEOUT || '5000')
const CALLBACK_OBJECTS = parseObjects(process.env.CALLBACK_OBJECTS || '{}')
const MAX_INFLIGHT = 4
const MAX_PENDING = 32
const MAX_PAYLOAD_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const inflight = new Set()
const pending = new Map()

export const isCallbackSet = CALLBACK_URL !== null

/** @param {import('./utils.js').WSSharedDoc} doc */
export const callbackHandler = doc => {
    if (!CALLBACK_URL) {return}
    const data = Object.create(null)
    for (const [name, type] of Object.entries(CALLBACK_OBJECTS)) {
        data[name] = {type, content: doc[accessors[type]](name).toJSON()}
    }
    const payload = JSON.stringify({room: doc.name, data})
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
        console.warn('Callback payload exceeds byte limit.')
        return
    }
    if (!pending.has(doc.name) && pending.size >= MAX_PENDING) {
        console.warn('Callback pending room limit reached.')
        return
    }
    pending.set(doc.name, payload)
    pump()
}

const pump = () => {
    for (const [room, payload] of pending) {
        if (inflight.size >= MAX_INFLIGHT) {return}
        if (inflight.has(room)) {continue}
        pending.delete(room)
        inflight.add(room)
        callbackRequest(payload, () => {inflight.delete(room); pump()})
    }
}

const callbackRequest = (payload, complete) => {
    let settled = false
    let req
    let response
    const finish = reason => {
        if (settled) {return}
        settled = true
        clearTimeout(timer)
        if (reason) {
            console.warn(`Callback failed (${reason}).`)
            response?.destroy()
            req?.destroy()
        }
        complete()
    }
    const timer = setTimeout(() => finish('deadline'), CALLBACK_TIMEOUT)
    try {
        const url = CALLBACK_URL
        req = (url.protocol === 'https:' ? https : http).request({
            ...urlToHttpOptions(url),
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}
        })
        req.on('error', () => finish('transport'))
        req.on('response', incoming => {
            if (settled) {incoming.destroy(); return}
            response = incoming
            let bytes = 0
            incoming.on('error', () => finish('response'))
            incoming.on('aborted', () => finish('aborted'))
            incoming.on('close', () => finish('closed'))
            incoming.on('data', chunk => {
                bytes += chunk.length
                if (bytes > MAX_RESPONSE_BYTES) {finish('response limit')}
            })
            incoming.on('end', () => finish())
            if (incoming.statusCode < 200 || incoming.statusCode >= 300) {finish('status')}
        })
        req.end(payload)
    } catch {finish('transport')}
}
