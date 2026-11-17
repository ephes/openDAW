import {Errors} from "@opendaw/lib-std"

export type ToneModel = {id: number, name: string, size: string, model_url: string}
export type ToneResponse = {id: number, title: string, updated_at: string, models: ReadonlyArray<ToneModel>}
export const ToneTransferLimits = Object.freeze({Metadata: 1024 * 1024, Model: 16 * 1024 * 1024, MetadataMs: 15_000, ModelMs: 60_000})

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max
const id = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0
const url = (value: unknown): value is string => {
    if (!text(value, 8192)) {return false}
    try {const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password} catch {return false}
}

export const admitTone = (value: unknown): ToneResponse => {
    if (!record(value) || !id(value.id) || !text(value.title, 512) || !text(value.updated_at, 128)
        || !Array.isArray(value.models) || value.models.length === 0 || value.models.length > 256) {throw new Error("Invalid Tone3000 pack")}
    const ids = new Set<number>()
    const models = value.models.map((model: unknown): ToneModel => {
        if (!record(model) || !id(model.id) || ids.has(model.id) || !text(model.name, 512)
            || typeof model.size !== "string" || !["standard", "lite", "feather", "nano", "custom"].includes(model.size)
            || !url(model.model_url)) {throw new Error("Invalid Tone3000 model entry")}
        ids.add(model.id)
        return {id: model.id, name: model.name, size: model.size, model_url: model.model_url}
    })
    return {id: value.id, title: value.title, updated_at: value.updated_at, models}
}

export const admitModel = (source: string): string => {
    const value: unknown = JSON.parse(source)
    if (!record(value) || !text(value.version, 32) || !text(value.architecture, 128) || !record(value.config)
        || !Array.isArray(value.weights) || value.weights.length === 0
        || !value.weights.every(weight => typeof weight === "number" && Number.isFinite(weight))) {throw new Error("Invalid NAM model")}
    return source
}

const readText = async (source: string, maxBytes: number, deadlineMs: number, signal?: AbortSignal): Promise<string> => {
    if (!url(source)) {throw new Error("Invalid Tone3000 transfer URL")}
    signal?.throwIfAborted()
    const controller = new AbortController()
    const retire = () => controller.abort(Errors.AbortError)
    const timeout = setTimeout(retire, deadlineMs)
    signal?.addEventListener("abort", retire, {once: true})
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let response: Response | undefined
    let complete = false
    let rejectAbort!: () => void
    const aborted = new Promise<never>((_resolve, reject) => {rejectAbort = () => reject(Errors.AbortError)})
    controller.signal.addEventListener("abort", rejectAbort, {once: true})
    try {
        const request = fetch(source, {signal: controller.signal})
        // A non-cooperative transport may settle after the caller's deadline.
        void request.then(late => {
            if (controller.signal.aborted) {void late.body?.cancel().catch(() => {})}
        }, () => {})
        response = await Promise.race([request, aborted])
        if (!response.ok) {throw new Error(`Tone3000 transfer failed: ${response.status}`)}
        const length = response.headers.get("Content-Length")
        if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) {throw new Error("Tone3000 byte limit exceeded")}
        if (response.body === null) {throw new Error("Empty Tone3000 response")}
        reader = response.body.getReader()
        const bytes = new Uint8Array(maxBytes)
        let offset = 0
        for (;;) {
            const {done, value} = await Promise.race([reader.read(), aborted])
            if (done) {break}
            if (value.byteLength > maxBytes - offset) {throw new Error("Tone3000 byte limit exceeded")}
            bytes.set(value, offset)
            offset += value.byteLength
        }
        complete = true
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0, offset))
    } finally {
        clearTimeout(timeout)
        signal?.removeEventListener("abort", retire)
        controller.signal.removeEventListener("abort", rejectAbort)
        if (!complete) {
            controller.abort(Errors.AbortError)
            if (reader) {void reader.cancel().catch(() => {})}
            else {void response?.body?.cancel().catch(() => {})}
        }
        reader?.releaseLock()
    }
}

export const fetchTone = async (source: string, signal?: AbortSignal): Promise<ToneResponse> =>
    admitTone(JSON.parse(await readText(source, ToneTransferLimits.Metadata, ToneTransferLimits.MetadataMs, signal)))

export const downloadModel = async (source: string, signal?: AbortSignal): Promise<string> =>
    admitModel(await readText(source, ToneTransferLimits.Model, ToneTransferLimits.ModelMs, signal))
