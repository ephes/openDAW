import {EmptyExec, Lazy, Notifier, Nullable, Progress, unitValue} from "@opendaw/lib-std"
import type {FFmpeg, LogEvent} from "@ffmpeg/ffmpeg"
import {Mp3Converter} from "./mp3"
import {FlacConverter} from "./flac"

export type AcceptedSource = File | Blob

export class FFmpegWorker {
    static async load(progress: Progress.Handler = Progress.Empty): Promise<FFmpegWorker> {
        return Loader.loadOrAttach(progress)
    }

    readonly #ffmpeg: FFmpeg
    #operation: Promise<unknown> = Promise.resolve()
    readonly #progressNotifier: Notifier<unitValue>

    constructor(ffmpeg: FFmpeg) {
        this.#ffmpeg = ffmpeg
        this.#progressNotifier = new Notifier<unitValue>()
        this.#ffmpeg.on("log", ({message}: LogEvent) => console.debug("[FFmpeg]", message))
        this.#ffmpeg.on("progress", event => this.#progressNotifier.notify(event.progress))
    }

    get ffmpeg(): FFmpeg {return this.#ffmpeg}
    get loaded(): boolean {return this.#ffmpeg.loaded}
    get progressNotifier(): Notifier<unitValue> {return this.#progressNotifier}

    @Lazy
    mp3Converter(): Mp3Converter {return new Mp3Converter(this)}

    @Lazy
    flacConverter(): FlacConverter {return new FlacConverter(this)}

    async fetchFileData(source: string): Promise<Uint8Array> {
        const response = await fetch(source)
        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.statusText}`)
        }
        return new Uint8Array(await response.arrayBuffer())
    }

    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.#operation.then(operation)
        this.#operation = result.catch(() => {})
        return result
    }

    async cleanupFiles(files: string[]): Promise<void> {
        return Promise.all(files.map(file => this.#ffmpeg.deleteFile(file).catch())).then(EmptyExec)
    }
}

class Loader {
    static async loadOrAttach(progress: Progress.Handler): Promise<FFmpegWorker> {
        if (this.#loader === null) {
            this.#loader = new Loader()
        }
        const subscription = this.#loader.#progressNotifier.subscribe(progress)
        return this.#loader.load().finally(() => subscription.terminate())
    }

    static #loader: Nullable<Loader> = null

    readonly #progressNotifier = new Notifier<unitValue>()

    #pending: Nullable<Promise<FFmpegWorker>> = null
    #worker: Nullable<FFmpegWorker> = null

    load(): Promise<FFmpegWorker> {
        if (this.#worker !== null && !this.#worker.loaded) {
            this.#worker = null
            this.#pending = null
        }
        return this.#pending ??= this.initialize().then(worker => this.#worker = worker).catch(error => {
            this.#pending = null
            throw error
        })
    }

    private async initialize(): Promise<FFmpegWorker> {
        const controller = new AbortController()
        const {signal} = controller
        const deadline = setTimeout(() => controller.abort(new Error("FFmpeg startup timed out")), 120_000)
        const urls: string[] = []
        let ffmpeg: FFmpeg | undefined
        // Race even APIs that do not observe AbortSignal (notably core initialization).
        const wait = <T>(promise: Promise<T>): Promise<T> => {
            signal.throwIfAborted()
            return new Promise<T>((resolve, reject) => {
                const abort = () => reject(signal.reason)
                signal.addEventListener("abort", abort, {once: true})
                promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
            })
        }
        try {
            const {FFmpeg} = await wait(import("@ffmpeg/ffmpeg"))
            ffmpeg = new FFmpeg()
            const download = async (name: string, limit: number): Promise<ArrayBuffer> => {
                const response = await wait(fetch(`https://package.opendaw.studio/${name}`, {signal}))
                if (!response.ok) throw new Error("FFmpeg core download failed")
                if (!response.body) throw new Error("FFmpeg core download has no body")
                const reader = response.body.getReader()
                const cancel = () => { void reader.cancel().catch(() => {}) }
                signal.addEventListener("abort", cancel, {once: true})
                let complete = false
                try {
                    const header = response.headers.get("content-length")
                    const encoding = response.headers.get("content-encoding")
                    const total = header === null || (encoding !== null && encoding !== "identity")
                        ? null : Number(header)
                    if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || total > limit)) {
                        throw new Error("FFmpeg core download size refused")
                    }
                    const chunks: Uint8Array[] = []
                    let received = 0
                    for (;;) {
                        const {done, value} = await wait(reader.read())
                        signal.throwIfAborted()
                        if (done) break
                        received += value.byteLength
                        if (received > limit || (total !== null && received > total)) {
                            throw new Error("FFmpeg core download size refused")
                        }
                        chunks.push(value)
                        if (total !== null) this.#progressNotifier.notify(received / total)
                    }
                    if (received === 0 || (total !== null && received !== total)) {
                        throw new Error("FFmpeg core download truncated")
                    }
                    const result = new Uint8Array(received)
                    let position = 0
                    for (const chunk of chunks) {
                        result.set(chunk, position)
                        position += chunk.byteLength
                    }
                    complete = true
                    return result.buffer
                } finally {
                    signal.removeEventListener("abort", cancel)
                    if (!complete) cancel()
                    reader.releaseLock()
                }
            }
            const coreData = await download("ffmpeg-core.js", 2 * 1024 * 1024)
            const wasmData = await download("ffmpeg-core.wasm", 40 * 1024 * 1024)
            const coreURL = URL.createObjectURL(new Blob([coreData], {type: "text/javascript"}))
            urls.push(coreURL)
            const wasmURL = URL.createObjectURL(new Blob([wasmData], {type: "application/wasm"}))
            urls.push(wasmURL)
            await wait(ffmpeg.load({coreURL, wasmURL}))
            return new FFmpegWorker(ffmpeg)
        } catch (error) {
            controller.abort(error)
            try { ffmpeg?.terminate() } catch { console.warn("[FFmpeg] Startup cleanup failed") }
            throw error
        } finally {
            clearTimeout(deadline)
            urls.forEach(url => URL.revokeObjectURL(url))
        }
    }
}
