import {
    asDefined,
    DefaultObservableValue,
    Lazy,
    isDefined,
    Optional,
    panic,
    Procedure,
    RuntimeNotifier,
    tryCatch,
    TimeSpan,
    unitValue,
    UUID
} from "@opendaw/lib-std"
import {IntervalRetryOption, network, Promises} from "@opendaw/lib-runtime"
import {Sample, SampleMetaData} from "@opendaw/studio-adapters"
import {SampleAPI} from "@opendaw/studio-core"
import {base64Credentials, OpenDAWHeaders} from "../OpenDAWHeaders"
import {z} from "zod"
import {AudioData, WavFile} from "@opendaw/lib-dsp"

// Standard openDAW samples (considered to be non-removable)
/** @internal */
export class OpenSampleAPI implements SampleAPI {
    static readonly ApiRoot = "https://api.opendaw.studio/samples"
    static readonly FileRoot = "https://assets.opendaw.studio/samples"
    static readonly MaxDownloadBytes = 64 * 1024 * 1024
    static readonly DownloadTimeoutMs = 60000

    @Lazy
    static get(): OpenSampleAPI {return new OpenSampleAPI()}

    private constructor() {}

    #catalog: Optional<Promise<ReadonlyArray<Sample>>>

    all(): Promise<ReadonlyArray<Sample>> {
        if (isDefined(this.#catalog)) {return this.#catalog}
        const catalog = network.defaultFetch(`${OpenSampleAPI.ApiRoot}/list.php`, OpenDAWHeaders)
            .then(response => {
                if (!response.ok) {return panic(`Sample catalog unavailable: ${response.status}`)}
                return response.json().then(json => z.array(Sample).parse(json))
            })
        this.#catalog = catalog
        void catalog.catch(() => {if (this.#catalog === catalog) {this.#catalog = undefined}})
        return catalog
    }

    async get(uuid: UUID.Bytes, signal?: AbortSignal): Promise<Sample> {
        const url = `${OpenSampleAPI.ApiRoot}/get.php?uuid=${UUID.toString(uuid)}`
        const response = await this.#fetchResponse(url, signal)
        if (!response.ok) {
            return panic(`Sample not found: ${UUID.toString(uuid)}`)
        }
        const json = await response.json()
        signal?.throwIfAborted()
        if ("error" in json) {
            return panic(json.error)
        }
        const sample = Sample.parse(json)
        if (!UUID.equals(UUID.parse(sample.uuid), uuid)) {return panic("Sample identity does not match requested UUID")}
        return Object.freeze({...sample, uuid: UUID.toString(uuid), origin: "openDAW"})
    }

    async load(uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, Sample]> {
        console.debug(`load ${UUID.toString(uuid)}`)
        const controller = new AbortController()
        const expired = Promise.withResolvers<never>()
        const timer = setTimeout(() => {
            const reason = new Error("Stock sample download deadline exceeded")
            controller.abort(reason)
            expired.reject(reason)
        }, OpenSampleAPI.DownloadTimeoutMs)
        try {
            const [arrayBuffer, sample] = await Promise.race([
                this.#download(uuid, progress, controller.signal), expired.promise
            ])
            const audioData = WavFile.decodeFloats(arrayBuffer)
            return [audioData, {...sample,
                duration: audioData.numberOfFrames / audioData.sampleRate,
                sample_rate: audioData.sampleRate
            }]
        } finally {
            clearTimeout(timer)
        }
    }

    async #fetchResponse(url: string, signal?: AbortSignal): Promise<Response> {
        const retry = new IntervalRetryOption(3, TimeSpan.seconds(3))
        return Promises.retry(async () => {
            signal?.throwIfAborted()
            const response = await network.limitFetch(url, {...OpenDAWHeaders, signal})
            if (signal?.aborted) {
                void response.body?.cancel().catch(() => {})
                signal.throwIfAborted()
            }
            return response
        }, {retry: (reason, exec) => !signal?.aborted && retry.retry(reason, exec)})
    }

    async #download(uuid: UUID.Bytes, progress: Procedure<unitValue>, signal: AbortSignal): Promise<[ArrayBuffer, Sample]> {
        const sample = await this.get(uuid, signal)
        signal.throwIfAborted()
        const response = await this.#fetchResponse(`${OpenSampleAPI.FileRoot}/${UUID.toString(uuid)}`, signal)
        if (!response.ok) {return panic(`Failed to fetch sample: ${response.status} ${response.statusText}`)}
        return [await this.#readBody(response, progress, signal), sample]
    }

    async #readBody(response: Response, progress: Procedure<unitValue>, signal: AbortSignal): Promise<ArrayBuffer> {
        const reader = asDefined(response.body, "No body in response").getReader()
        const total = Number(response.headers.get("Content-Length") ?? "0")
        const chunks: Array<Uint8Array<ArrayBuffer>> = []
        let loaded = 0
        let complete = false
        let cancelled = false
        const cancel = () => {
            if (cancelled) {return}
            cancelled = true
            void reader.cancel(signal.reason).catch(() => {})
        }
        signal.addEventListener("abort", cancel, {once: true})
        try {
            signal.throwIfAborted()
            if (total > OpenSampleAPI.MaxDownloadBytes) {return panic("Stock sample byte limit exceeded")}
            for (;;) {
                const {done, value} = await reader.read()
                signal.throwIfAborted()
                if (done) {complete = true; break}
                if (value.byteLength > OpenSampleAPI.MaxDownloadBytes - loaded) {
                    return panic("Stock sample byte limit exceeded")
                }
                loaded += value.byteLength
                chunks.push(new Uint8Array(value))
                progress(loaded / total)
            }
            const buffer = await new Blob(chunks).arrayBuffer()
            signal.throwIfAborted()
            return buffer
        } finally {
            signal.removeEventListener("abort", cancel)
            if (!complete) {cancel()}
            reader.releaseLock()
        }
    }

    async upload(arrayBuffer: ArrayBuffer, metaData: SampleMetaData): Promise<void> {
        const progress = new DefaultObservableValue(0.0)
        const dialog = RuntimeNotifier.progress({headline: "Uploading", progress})
        const formData = new FormData()
        Object.entries(metaData).forEach(([key, value]) => formData.set(key, String(value)))
        const params = new URLSearchParams(location.search)
        const accessKey = asDefined(params.get("access-key"), "Cannot upload without access-key.")
        formData.set("key", accessKey)
        formData.append("file", new Blob([arrayBuffer]))
        console.log("upload data", Array.from(formData.entries()), arrayBuffer.byteLength)
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener("progress", (event: ProgressEvent) => {
            if (event.lengthComputable) {
                progress.setValue(event.loaded / event.total)
            }
        })
        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                dialog.terminate()
                if (xhr.status === 200) {
                    RuntimeNotifier.info({message: xhr.responseText})
                } else {
                    const {status, value} =
                        tryCatch(() => JSON.parse(xhr.responseText).message ?? "Unknown error message")
                    RuntimeNotifier.info({
                        headline: "Upload Failure",
                        message: status === "success" ? value : "Unknown error"
                    })
                }
            }
        }
        xhr.open("POST", `${OpenSampleAPI.ApiRoot}/upload.php`, true)
        xhr.setRequestHeader("Authorization", `Basic ${base64Credentials}`)
        xhr.send(formData)
    }

    allowsUpload(): boolean {return false}
}
