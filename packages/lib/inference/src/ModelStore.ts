import {asDefined, isDefined, Option, panic, Procedure, tryCatch, unitValue} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {ModelDescriptor} from "./Task"
import {requireInferenceConfig} from "./InferenceConfig"

export interface FetchOptions {
    readonly progress?: Procedure<unitValue>
    readonly signal?: AbortSignal
    readonly maxBytes?: number
    readonly timeoutMs?: number
}

interface ModelMeta {
    readonly sha256: string
    readonly bytes: number
    readonly version: string
    readonly downloadedAt: number
}

export const MAX_MODEL_BYTES = 512 * 1024 * 1024
export const MODEL_TIMEOUT_MS = 60 * 60 * 1000
export const MAX_MODEL_TIMEOUT_MS = 24 * 60 * 60 * 1000

const ROOT = "inference/models"
const MODEL_FILE = "model.onnx"
const META_FILE = "meta.json"

const modelPath = (taskKey: string, version: string) => `${ROOT}/${taskKey}/${version}/${MODEL_FILE}`
const metaPath = (taskKey: string, version: string) => `${ROOT}/${taskKey}/${version}/${META_FILE}`
const taskPath = (taskKey: string) => `${ROOT}/${taskKey}`
const versionPath = (taskKey: string, version: string) => `${ROOT}/${taskKey}/${version}`

export namespace ModelStore {
    export const ensure = async (taskKey: string,
                                 model: ModelDescriptor,
                                 options?: FetchOptions): Promise<Uint8Array> => {
        options?.signal?.throwIfAborted()
        const {opfs} = requireInferenceConfig()
        const cached = await readCached(opfs, taskKey, model)
        options?.signal?.throwIfAborted()
        if (cached.nonEmpty()) {
            options?.progress?.(1.0)
            return cached.unwrap()
        }
        const bytes = await download(model, options)
        const digest = await sha256Hex(bytes)
        if (digest !== model.sha256) {
            return panic(`Model SHA-256 mismatch for ${taskKey}: expected ${model.sha256}, got ${digest}`)
        }
        await opfs.write(modelPath(taskKey, model.version), bytes)
        const meta: ModelMeta = {
            sha256: model.sha256,
            bytes: bytes.byteLength,
            version: model.version,
            downloadedAt: Date.now()
        }
        await opfs.write(metaPath(taskKey, model.version), new TextEncoder().encode(JSON.stringify(meta)))
        return bytes
    }

    export const evict = async (taskKey: string, version?: string): Promise<void> => {
        const {opfs} = requireInferenceConfig()
        const path = isDefined(version) ? versionPath(taskKey, version) : taskPath(taskKey)
        await Promises.tryCatch(opfs.delete(path))
    }

    export const isCached = async (taskKey: string, model: ModelDescriptor): Promise<boolean> => {
        const {opfs} = requireInferenceConfig()
        const meta = await readMeta(opfs, taskKey, model.version)
        if (meta.isEmpty() || meta.unwrap().sha256 !== model.sha256) {return false}
        // Trust meta.json's recorded sha; avoid reading 300+ MB just to probe.
        return opfs.exists(modelPath(taskKey, model.version))
    }

    const readCached = async (opfs: OpfsProtocol,
                              taskKey: string,
                              model: ModelDescriptor): Promise<Option<Uint8Array>> => {
        const meta = await readMeta(opfs, taskKey, model.version)
        if (meta.isEmpty() || meta.unwrap().sha256 !== model.sha256) {return Option.None}
        const result = await Promises.tryCatch(opfs.read(modelPath(taskKey, model.version)))
        if (result.status !== "resolved" || result.value.byteLength > MAX_MODEL_BYTES ||
            result.value.byteLength !== meta.unwrap().bytes || meta.unwrap().version !== model.version) {return Option.None}
        const bytes = result.value
        return await sha256Hex(bytes) === model.sha256 ? Option.wrap(bytes) : Option.None
    }

    const readMeta = async (opfs: OpfsProtocol,
                            taskKey: string,
                            version: string): Promise<Option<ModelMeta>> => {
        const result = await Promises.tryCatch(opfs.read(metaPath(taskKey, version)))
        if (result.status === "rejected") {return Option.None}
        const {status, value} = tryCatch(() =>
            JSON.parse(new TextDecoder().decode(result.value)) as ModelMeta)
        return status === "success" && value !== null && typeof value === "object" &&
            typeof value.sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.sha256) &&
            Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_MODEL_BYTES &&
            typeof value.version === "string" && value.version.length > 0 &&
            Number.isFinite(value.downloadedAt) && value.downloadedAt >= 0 ? Option.wrap(value) : Option.None
    }

    const download = async (model: ModelDescriptor, options?: FetchOptions): Promise<Uint8Array> => {
        const maxBytes = Math.min(options?.maxBytes ?? MAX_MODEL_BYTES, MAX_MODEL_BYTES)
        const timeoutMs = Math.min(options?.timeoutMs ?? requireInferenceConfig().modelDownloadTimeoutMs ?? MODEL_TIMEOUT_MS, MAX_MODEL_TIMEOUT_MS)
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new Error("Invalid model transfer limits")
        }
        const deadline = new AbortController()
        const signal = options?.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal
        signal.throwIfAborted()
        const timer = setTimeout(() => deadline.abort(new Error("Model download timed out")), timeoutMs)
        let rejectAbort!: (reason: unknown) => void
        const aborted = new Promise<never>((_resolve, reject) => {rejectAbort = reject})
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        let readerCancelled = false
        const cancelReader = () => {
            if (reader && !readerCancelled) {
                readerCancelled = true
                void reader.cancel(signal.reason).catch(() => {})
            }
        }
        const onAbort = () => {rejectAbort(signal.reason); cancelReader()}
        signal.addEventListener("abort", onAbort, {once: true})
        let completed = false
        const chunks: Uint8Array[] = []
        try {
            const response = await Promise.race([fetch(model.url, {signal, mode: "cors", credentials: "omit"}), aborted])
            if (!response.ok) {
                const url = new URL(model.url, typeof location === "undefined" ? "https://local.invalid/" : location.href)
                const source = `${url.origin}${url.pathname}`.slice(0, 300)
                throw new Error(`Model fetch failed: ${response.status} ${response.statusText.slice(0, 80)} (${source})`)
            }
            const declared = Number(response.headers.get("Content-Length"))
            reader = asDefined(response.body, "Empty response body").getReader()
            if (Number.isFinite(declared) && declared > maxBytes) {throw new Error("Model download byte limit exceeded")}
            const total = declared > 0 ? declared : model.bytes
            let loaded = 0
            for (;;) {
                const {done, value} = await reader.read()
                signal.throwIfAborted()
                if (done) {break}
                if (value.byteLength > maxBytes - loaded) {throw new Error("Model download byte limit exceeded")}
                loaded += value.byteLength
                chunks.push(value)
                options?.progress?.(Number.isFinite(total) && total > 0 ? Math.min(loaded / total, 1) : 0.5)
            }
            const result = new Uint8Array(loaded)
            let offset = 0
            for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.byteLength}
            completed = true
            return result
        } finally {
            clearTimeout(timer)
            signal.removeEventListener("abort", onAbort)
            chunks.length = 0
            if (reader) {
                if (!completed) {cancelReader()}
                reader.releaseLock()
            }
        }
    }

    const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
        const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
        return Array.from(new Uint8Array(digest))
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("")
    }
}
