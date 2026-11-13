import {asDefined, DefaultObservableValue, ObservableValue} from "@opendaw/lib-std"
import {Files} from "@opendaw/lib-dom"
import {Promises} from "@opendaw/lib-runtime"
import type {
    AudioSample as AudioSampleClass,
    AudioSampleSource,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    Target
} from "mediabunny"
import {waitForVideoTask} from "./VideoExportTask"
import {BoundedVideoBuffer} from "./BoundedVideoBuffer"
import {validateBufferedVideoConfig, validateVideoConfig} from "./VideoExportLimits"
import type {VideoExportConfig, VideoExporter} from "./VideoExporter"

const closeSafely = (close: () => void): void => {
    try {close()} catch {console.warn("Video resource cleanup failed")}
}

type EncoderState = {
    output: Output<Mp4OutputFormat, Target>
    videoSource: CanvasSource
    audioSource: AudioSampleSource
    AudioSample: typeof AudioSampleClass
    ctx: OffscreenCanvasRenderingContext2D
}

export abstract class WebCodecsVideoExporter implements VideoExporter {
    static isSupported(): boolean {
        return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined"
    }

    protected static async createEncoder(config: VideoExportConfig, target: Target, signal?: AbortSignal): Promise<EncoderState> {
        validateVideoConfig(config, config.durationSeconds ?? 0)
        const {Output, Mp4OutputFormat, CanvasSource, AudioSampleSource, AudioSample} = await waitForVideoTask(import("mediabunny"), signal)
        signal?.throwIfAborted()
        const canvas = new OffscreenCanvas(config.width, config.height)
        const ctx = asDefined(canvas.getContext("2d"))
        const output = new Output({format: new Mp4OutputFormat(), target})
        let cancellation: Promise<void> | undefined
        const cancel = (): Promise<void> => cancellation ??= output.cancel().catch(() => {console.warn("Video encoder rollback failed")})
        const onAbort = () => {void cancel()}
        signal?.addEventListener("abort", onAbort, {once: true})
        let videoSource: CanvasSource | undefined
        let audioSource: AudioSampleSource | undefined
        try {
            videoSource = new CanvasSource(canvas, {
                codec: "avc",
                bitrate: config.videoBitrate ?? 5_000_000,
                bitrateMode: "constant",
                keyFrameInterval: 2
            })
            output.addVideoTrack(videoSource)
            const audioBitrate = config.audioBitrate ?? 192_000
            const audioCodec = await waitForVideoTask(
                WebCodecsVideoExporter.#pickAudioCodec(config.sampleRate, config.numberOfChannels, audioBitrate), signal)
            signal?.throwIfAborted()
            audioSource = new AudioSampleSource({codec: audioCodec, bitrate: audioBitrate})
            output.addAudioTrack(audioSource)
            await waitForVideoTask(output.start(), signal)
            signal?.throwIfAborted()
            return {output, videoSource, audioSource, AudioSample, ctx}
        } catch (error) {
            try {await waitForVideoTask(cancel(), signal)} catch { /* Cancellation already owns rollback. */ }
            if (!signal?.aborted) {
                closeSafely(() => videoSource?.close())
                closeSafely(() => audioSource?.close())
            }
            throw error
        } finally {
            signal?.removeEventListener("abort", onAbort)
        }
    }

    static async #pickAudioCodec(sampleRate: number, numberOfChannels: number, bitrate: number): Promise<"aac" | "opus"> {
        const aacSupported = await Promises.tryCatch(AudioEncoder.isConfigSupported({
            codec: "mp4a.40.2", sampleRate, numberOfChannels, bitrate
        }))
        if (aacSupported.status === "resolved" && aacSupported.value.supported === true) {return "aac"}
        return "opus"
    }

    readonly #config: VideoExportConfig
    readonly #output: Output<Mp4OutputFormat, Target>
    readonly #videoSource: CanvasSource
    readonly #audioSource: AudioSampleSource
    readonly #AudioSample: typeof AudioSampleClass
    readonly #ctx: OffscreenCanvasRenderingContext2D
    readonly #progress: DefaultObservableValue<number> = new DefaultObservableValue(0)

    readonly #abortController = new AbortController()
    #state: "active" | "finalizing" | "finalized" | "aborted" = "active"
    #abortTask: Promise<void> | undefined
    #audioSamples = 0
    #lastTimestamp = -1

    protected constructor(config: VideoExportConfig, encoder: EncoderState) {
        this.#config = config
        this.#output = encoder.output
        this.#videoSource = encoder.videoSource
        this.#audioSource = encoder.audioSource
        this.#AudioSample = encoder.AudioSample
        this.#ctx = encoder.ctx
    }

    get progress(): ObservableValue<number> {return this.#progress}

    async addFrame(canvas: OffscreenCanvas, audio: Float32Array[], timestampSeconds: number): Promise<void> {
        this.assertActive()
        const numberOfFrames = audio[0]?.length
        if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0 || timestampSeconds <= this.#lastTimestamp) {
            throw new Error("Video timestamps must be finite, nonnegative and strictly increasing.")
        }
        if (audio.length !== this.#config.numberOfChannels || !Number.isSafeInteger(numberOfFrames)
            || numberOfFrames < 0 || numberOfFrames > this.#config.sampleRate
            || Array.from({length: this.#config.numberOfChannels}, (_, index) => audio[index])
                .some(channel => !(channel instanceof Float32Array) || channel.length !== numberOfFrames)) {
            throw new Error("Video audio must contain equal channel planes of at most one second.")
        }
        this.#lastTimestamp = timestampSeconds
        this.#ctx.drawImage(canvas, 0, 0)
        const frameDuration = 1 / this.#config.frameRate
        await waitForVideoTask(this.#videoSource.add(timestampSeconds, frameDuration), this.#abortController.signal)
        this.assertActive()
        if (audio.length > 0 && audio[0].length > 0) {
            const numberOfChannels = audio.length
            const numberOfFrames = audio[0].length
            const timestampUs = Math.round(this.#audioSamples / this.#config.sampleRate * 1_000_000)
            const audioBuffer = new Float32Array(numberOfChannels * numberOfFrames)
            for (let channel = 0; channel < numberOfChannels; channel++) {
                audioBuffer.set(audio[channel], channel * numberOfFrames)
            }
            const audioData = new AudioData({
                format: "f32-planar",
                sampleRate: this.#config.sampleRate,
                numberOfFrames,
                numberOfChannels,
                timestamp: timestampUs,
                data: audioBuffer
            })
            try {
                const audioSample = new this.#AudioSample(audioData)
                try {
                    audioSample.setTimestamp(this.#audioSamples / this.#config.sampleRate)
                    await waitForVideoTask(this.#audioSource.add(audioSample), this.#abortController.signal)
                    this.assertActive()
                    this.#audioSamples += numberOfFrames
                } finally {
                    closeSafely(() => audioSample.close())
                }
            } finally {
                // AudioSample takes ownership of AudioData. If construction/close
                // failed before releasing it, the native public format is still non-null.
                if (audioData.format !== null) {closeSafely(() => audioData.close())}
            }
        }
    }

    protected assertActive(): void {
        if (this.#state !== "active") {throw new Error("Video export is no longer active.")}
    }

    protected async finalizeOutput(): Promise<void> {
        this.assertActive()
        this.#state = "finalizing"
        await waitForVideoTask(this.#output.finalize(), this.#abortController.signal)
        this.#abortController.signal.throwIfAborted()
    }

    protected assertFinalizing(): void {
        if (this.#state !== "finalizing") {throw new Error("Video export was aborted.")}
    }

    protected complete(): void {
        this.assertFinalizing()
        this.#state = "finalized"
        this.#progress.setValue(1)
    }

    protected async abortTarget(): Promise<void> {}

    abort(reason: unknown = new DOMException("Video export was aborted.", "AbortError")): Promise<void> {
        if (this.#abortTask !== undefined) {return this.#abortTask}
        if (this.#state === "finalized") {return Promise.resolve()}
        this.#state = "aborted"
        this.#abortController.abort(reason)
        // Start both independently: muxer teardown must not delay discarding the file.
        this.#abortTask = Promise.allSettled([this.#output.cancel(), this.abortTarget()]).then(() => {})
        return this.#abortTask
    }

    abstract finalize(): Promise<void>
    terminate(): void {void this.abort().catch(() => {})}
}

export class StreamVideoExporter extends WebCodecsVideoExporter {
    static async create(config: VideoExportConfig, writable: WritableStream, signal?: AbortSignal): Promise<StreamVideoExporter> {
        const writer = writable.getWriter()
        let abortTask: Promise<void> | undefined
        const abortWriter = () => abortTask ??= writer.abort().catch(() => {
            console.warn("Video writable rollback failed")
        }).finally(() => writer.releaseLock())
        const onAbort = () => {void abortWriter()}
        signal?.addEventListener("abort", onAbort, {once: true})
        try {
            const {StreamTarget} = await waitForVideoTask(import("mediabunny"), signal)
            signal?.throwIfAborted()
            // Output.cancel closes its target. Only our successful finalize may commit
            // the underlying file; muxer close must not publish a partial export.
            const target = new StreamTarget(new WritableStream({write: chunk => writer.write(chunk)}), {chunked: true})
            const encoder = await WebCodecsVideoExporter.createEncoder(config, target, signal)
            const exporter = new StreamVideoExporter(config, encoder, writer)
            if (signal?.aborted) {
                void exporter.abort(signal.reason)
                signal.throwIfAborted()
            }
            return exporter
        } catch (error) {
            void abortWriter()
            throw error
        } finally {
            signal?.removeEventListener("abort", onAbort)
        }
    }

    readonly #writer: WritableStreamDefaultWriter

    private constructor(config: VideoExportConfig, encoder: EncoderState, writer: WritableStreamDefaultWriter) {
        super(config, encoder)
        this.#writer = writer
    }

    async finalize(): Promise<void> {
        try {
            await this.finalizeOutput()
            this.assertFinalizing()
            await this.#writer.close()
            this.complete()
            this.#writer.releaseLock()
        } catch (error) {
            void this.abort(error)
            throw error
        }
    }

    protected async abortTarget(): Promise<void> {
        try {await this.#writer.abort()} finally {this.#writer.releaseLock()}
    }
}

export class BufferVideoExporter extends WebCodecsVideoExporter {
    static async create(config: VideoExportConfig, signal?: AbortSignal): Promise<BufferVideoExporter> {
        validateBufferedVideoConfig(config)
        const {StreamTarget} = await waitForVideoTask(import("mediabunny"), signal)
        signal?.throwIfAborted()
        const buffer = new BoundedVideoBuffer()
        let exporter: BufferVideoExporter | undefined
        const target = new StreamTarget(new WritableStream({
            write: chunk => {
                try {buffer.write(chunk)} catch (error) {
                    void exporter?.abort(error)
                    throw error
                }
            }
        }), {chunked: true, chunkSize: 1024 * 1024})
        try {
            const encoder = await WebCodecsVideoExporter.createEncoder(config, target, signal)
            exporter = new BufferVideoExporter(config, encoder, buffer)
            if (signal?.aborted) {
                void exporter.abort(signal.reason)
                signal.throwIfAborted()
            }
            return exporter
        } catch (error) {
            buffer.clear()
            throw error
        }
    }

    readonly #buffer: BoundedVideoBuffer

    private constructor(config: VideoExportConfig, encoder: EncoderState, buffer: BoundedVideoBuffer) {
        super(config, encoder)
        this.#buffer = buffer
    }

    async finalize(): Promise<void> {
        try {
            await this.finalizeOutput()
            this.assertFinalizing()
            await Files.save(this.#buffer.finish(), {suggestedName: "opendaw-video.mp4"})
            this.complete()
            this.#buffer.clear()
        } catch (error) {
            void this.abort(error)
            throw error
        }
    }

    protected async abortTarget(): Promise<void> {this.#buffer.clear()}
}
