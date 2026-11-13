import {asDefined, DefaultObservableValue, ObservableValue} from "@opendaw/lib-std"
import {Files} from "@opendaw/lib-dom"
import {Promises} from "@opendaw/lib-runtime"
import type {
    AudioSample as AudioSampleClass,
    AudioSampleSource,
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    Target
} from "mediabunny"
import {validateVideoConfig} from "./VideoExportLimits"
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

    protected static async createEncoder(config: VideoExportConfig, target: Target): Promise<EncoderState> {
        validateVideoConfig(config)
        const {Output, Mp4OutputFormat, CanvasSource, AudioSampleSource, AudioSample} = await import("mediabunny")
        const canvas = new OffscreenCanvas(config.width, config.height)
        const ctx = asDefined(canvas.getContext("2d"))
        const output = new Output({format: new Mp4OutputFormat(), target})
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
            const audioCodec = await WebCodecsVideoExporter.#pickAudioCodec(config.sampleRate, config.numberOfChannels, audioBitrate)
            audioSource = new AudioSampleSource({codec: audioCodec, bitrate: audioBitrate})
            output.addAudioTrack(audioSource)
            await output.start()
            return {output, videoSource, audioSource, AudioSample, ctx}
        } catch (error) {
            try {await output.cancel()} catch {console.warn("Video encoder rollback failed")}
            closeSafely(() => videoSource?.close())
            closeSafely(() => audioSource?.close())
            throw error
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
            || numberOfFrames <= 0 || numberOfFrames > this.#config.sampleRate
            || audio.some(channel => !(channel instanceof Float32Array) || channel.length !== numberOfFrames)) {
            throw new Error("Video audio must contain equal, nonempty channel planes of at most one second.")
        }
        this.#lastTimestamp = timestampSeconds
        this.#ctx.drawImage(canvas, 0, 0)
        const frameDuration = 1 / this.#config.frameRate
        await this.#videoSource.add(timestampSeconds, frameDuration)
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
                    await this.#audioSource.add(audioSample)
                    this.assertActive()
                    this.#audioSamples += numberOfFrames
                } finally {
                    closeSafely(() => audioSample.close())
                }
            } finally {
                closeSafely(() => audioData.close())
            }
        }
    }

    protected assertActive(): void {
        if (this.#state !== "active") {throw new Error("Video export is no longer active.")}
    }

    protected async finalizeOutput(): Promise<void> {
        this.assertActive()
        this.#state = "finalizing"
        await this.#output.finalize()
        if (this.#state as string === "aborted") {throw new Error("Video export was aborted.")}
    }

    protected complete(): void {
        if (this.#state !== "finalizing") {throw new Error("Video export was aborted.")}
        this.#state = "finalized"
        this.#progress.setValue(1)
    }

    protected async abortTarget(): Promise<void> {}

    abort(): Promise<void> {
        if (this.#abortTask !== undefined) {return this.#abortTask}
        if (this.#state === "finalized") {return Promise.resolve()}
        this.#state = "aborted"
        // Start both independently: muxer teardown must not delay discarding the file.
        this.#abortTask = Promise.allSettled([this.#output.cancel(), this.abortTarget()]).then(() => {})
        return this.#abortTask
    }

    abstract finalize(): Promise<void>
    terminate(): void {void this.abort().catch(() => {})}
}

export class StreamVideoExporter extends WebCodecsVideoExporter {
    static async create(config: VideoExportConfig, writable: WritableStream): Promise<StreamVideoExporter> {
        const writer = writable.getWriter()
        try {
            const {StreamTarget} = await import("mediabunny")
            // Output.cancel closes its target. Only our successful finalize may commit
            // the underlying file; muxer close must not publish a partial export.
            const target = new StreamTarget(new WritableStream({write: chunk => writer.write(chunk)}), {chunked: true})
            const encoder = await WebCodecsVideoExporter.createEncoder(config, target)
            return new StreamVideoExporter(config, encoder, writer)
        } catch (error) {
            try {await writer.abort()} catch {console.warn("Video writable rollback failed")}
            writer.releaseLock()
            throw error
        }
    }

    readonly #writer: WritableStreamDefaultWriter

    private constructor(config: VideoExportConfig, encoder: EncoderState, writer: WritableStreamDefaultWriter) {
        super(config, encoder)
        this.#writer = writer
    }

    async finalize(): Promise<void> {
        await this.finalizeOutput()
        await this.#writer.close()
        this.complete()
        this.#writer.releaseLock()
    }

    protected async abortTarget(): Promise<void> {
        try {await this.#writer.abort()} finally {this.#writer.releaseLock()}
    }
}

export class BufferVideoExporter extends WebCodecsVideoExporter {
    static async create(config: VideoExportConfig): Promise<BufferVideoExporter> {
        const {BufferTarget} = await import("mediabunny")
        const bufferTarget = new BufferTarget()
        const encoder = await WebCodecsVideoExporter.createEncoder(config, bufferTarget)
        return new BufferVideoExporter(config, encoder, bufferTarget)
    }

    readonly #bufferTarget: BufferTarget

    private constructor(config: VideoExportConfig, encoder: EncoderState, bufferTarget: BufferTarget) {
        super(config, encoder)
        this.#bufferTarget = bufferTarget
    }

    async finalize(): Promise<void> {
        await this.finalizeOutput()
        await Files.save(asDefined(this.#bufferTarget.buffer), {suggestedName: "opendaw-video.mp4"})
        this.complete()
    }
}
