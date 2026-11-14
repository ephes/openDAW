import {
    asInstanceOf,
    DefaultObservableValue,
    isDefined,
    Option,
    panic,
    RuntimeNotifier,
    TimeSpan
} from "@opendaw/lib-std"
import {ppqn, RenderQuantum} from "@opendaw/lib-dsp"
import {OfflineEngineRenderer, Project} from "@opendaw/studio-core"
import {ShadertoyState} from "@/ui/shadertoy/ShadertoyState"
import {ShadertoyRunner} from "@/ui/shadertoy/ShadertoyRunner"
import {ShadertoyBox} from "@opendaw/studio-boxes"
import type {VideoExporter} from "@/video"
import {
    BufferVideoExporter,
    showVideoExportDialog,
    StreamVideoExporter,
    VideoOverlay,
    WebCodecsVideoExporter
} from "@/video"
import {waitForVideoTask} from "./VideoExportTask"
import {validateVideoConfig} from "./VideoExportLimits"
import {Promises} from "@opendaw/lib-runtime"

// Automatic duration renders the arrangement plus this fixed tail (sustained effects, reverb).
const AUTOMATIC_TAIL_SECONDS = 10

const isAllocationError = (error: unknown): boolean =>
    error instanceof RangeError && /alloc|array|memory/i.test(error.message)

const notifyFailure = async (failure: unknown): Promise<void> => {
    const message = isAllocationError(failure)
        ? "Video is too large for this browser. Please use Chrome."
        : String(failure)
    try {
        await RuntimeNotifier.info({headline: "Video Export Failed", message})
    } catch {console.warn("Video failure notification failed")}
}

export namespace VideoRenderer {
    export const render = async (source: Project, projectName: string, sampleRate: number): Promise<void> => {
        if (!WebCodecsVideoExporter.isSupported()) {
            return panic("WebCodecs is not supported in this browser")
        }
        const config = await showVideoExportDialog(sampleRate)
        const {width, height, frameRate, duration, overlay: overlayEnabled, videoBitrate} = config
        const exportConfig = {width, height, frameRate, sampleRate, numberOfChannels: 2, videoBitrate}
        let maxDuration: number
        try {
            validateVideoConfig(exportConfig, duration)
            const arrangementEnd = source.tempoMap.ppqnToSeconds(source.lastRegionAction())
            if (!Number.isFinite(arrangementEnd) || arrangementEnd < 0) {
                throw new Error("Invalid arrangement duration.")
            }
            maxDuration = duration > 0 ? duration : arrangementEnd + AUTOMATIC_TAIL_SECONDS
            validateVideoConfig(exportConfig, maxDuration)
        } catch (error) {
            // Refused settings must reach the user: the menu caller ignores the rejection.
            await notifyFailure(error)
            throw error
        }
        const timedExportConfig = {...exportConfig, durationSeconds: maxDuration}
        const controller = new AbortController()
        const {signal} = controller
        let exporter: VideoExporter | undefined
        let writable: WritableStream | undefined
        let exporterRetired = false
        let cancelled = false
        let completed = false
        let failed = false
        let failure: unknown
        const cleanups: Array<() => void> = []
        const release = () => {
            while (cleanups.length > 0) {
                try {cleanups.pop()!()} catch {console.warn("Video render cleanup failed")}
            }
        }
        const abortExporter = () => {
            if (exporter === undefined || exporterRetired) {return}
            exporterRetired = true
            void exporter.abort().catch(() => {console.warn("Video export abort failed")})
        }
        const abortWritable = () => {
            const pending = writable
            writable = undefined
            if (pending !== undefined && !pending.locked) {
                void pending.abort().catch(() => {console.warn("Video writable abort failed")})
            }
        }
        const retire = () => {release(); abortExporter(); abortWritable()}
        signal.addEventListener("abort", retire, {once: true})
        const wait = <T>(task: Promise<T>, late?: (value: T) => void): Promise<T> => waitForVideoTask(task, signal, late)
        const progressValue = new DefaultObservableValue(0.0)
        console.time("Render Video")
        try {
            const dialog = RuntimeNotifier.progress({
                headline: "Rendering video...",
                progress: progressValue,
                cancel: () => {
                    cancelled = true
                    controller.abort(new DOMException("Video export was cancelled.", "AbortError"))
                }
            })
            cleanups.push(() => dialog.terminate())
            if (isDefined(window.showSaveFilePicker)) {
                const result = await wait(Promises.tryCatch(window.showSaveFilePicker({suggestedName: "opendaw-video.mp4"})))
                if (result.status === "rejected") {return}
                writable = await wait(result.value.createWritable(), late => {void late.abort().catch(() => {})})
                signal.throwIfAborted()
            }
            const startupTimer = setTimeout(() => controller.abort(new Error("Video encoder startup timed out after 10 seconds.")), 10_000)
            try {
                exporter = await wait<VideoExporter>(writable !== undefined
                    ? StreamVideoExporter.create(timedExportConfig, writable, signal)
                    : BufferVideoExporter.create(timedExportConfig, signal),
                    late => {void late.abort().catch(() => {})})
                signal.throwIfAborted()
                writable = undefined // The completed exporter now owns the writer.
            } finally {clearTimeout(startupTimer)}
            const project = source.copy()
            cleanups.push(() => project.terminate())
            const {boxGraph, timelineBox: {loopArea: {enabled}}} = project
            boxGraph.beginTransaction()
            try {enabled.setValue(false)} finally {boxGraph.endTransaction()}
            dialog.message = "Initializing..."
            const estimator = TimeSpan.createEstimator()
            const shadertoyCanvas = new OffscreenCanvas(width, height)
            const shadertoyContext = shadertoyCanvas.getContext("webgl2")!
            cleanups.push(() => shadertoyContext?.getExtension?.("WEBGL_lose_context")?.loseContext())
            const shadertoyState = new ShadertoyState(project)
            cleanups.push(() => shadertoyState.terminate())
            const shadertoyRunner = new ShadertoyRunner(shadertoyState, shadertoyContext)
            cleanups.push(() => shadertoyRunner.terminate())
            const shadertoy = project.rootBoxAdapter.box.shadertoy
            if (shadertoy.nonEmpty()) {
                const code = asInstanceOf(shadertoy.targetVertex.unwrap().box, ShadertoyBox).shaderCode.getValue()
                shadertoyRunner.compile(code)
            } else {
                shadertoyRunner.compile(
                    `void mainImage(out vec4 fragColor, in vec2 fragCoord){vec2 uv = fragCoord/iResolution.xy;vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,1,2));fragColor = vec4(col,1.0);}`)
            }
            const compositionCanvas = new OffscreenCanvas(width, height)
            const compositionCtx = compositionCanvas.getContext("2d")!
            const signatureTrack = project.timelineBoxAdapter.signatureTrack
            const overlay = overlayEnabled ? await wait(VideoOverlay.create({
                width, height, projectName,
                toParts: (position: ppqn) => signatureTrack.toParts(position)
            }, signal), late => late.terminate()) : undefined
            if (overlay !== undefined) {cleanups.push(() => overlay.terminate())}
            signal.throwIfAborted()

            const renderer = await wait(OfflineEngineRenderer.create(project, Option.None, sampleRate), late => late.terminate())
            cleanups.push(() => renderer.terminate())
            cleanups.push(() => renderer.stop())
            signal.throwIfAborted()
            await wait(renderer.play())
            signal.throwIfAborted()

            const tempoMap = project.tempoMap
            const estimatedDurationInSeconds = duration > 0
                ? duration
                : tempoMap.ppqnToSeconds(project.lastRegionAction())
            const maxFrames = Math.ceil(maxDuration * frameRate)
            const estimatedNumberOfFrames = Math.ceil(estimatedDurationInSeconds * frameRate)

            const idealSamplesPerFrame = sampleRate / frameRate
            let samplesRendered = 0
            let frameIndex = 0

            while (frameIndex < maxFrames) {
                signal.throwIfAborted()
                if (frameIndex >= estimatedNumberOfFrames) {
                    dialog.message = `Rendering tail...`
                } else {
                    const progress = frameIndex / estimatedNumberOfFrames
                    dialog.message = `Frame ${frameIndex + 1} / ${estimatedNumberOfFrames} (${estimator(progress)})`
                    progressValue.setValue(progress)
                }

                const targetSamples = Math.round((frameIndex + 1) * idealSamplesPerFrame)
                const samplesToRender = targetSamples - samplesRendered
                const quantumsNeeded = Math.ceil(samplesToRender / RenderQuantum)
                const actualSamplesToRender = quantumsNeeded * RenderQuantum
                const channels = await wait(renderer.step(actualSamplesToRender))
                signal.throwIfAborted()
                samplesRendered += actualSamplesToRender
                project.liveStreamReceiver.dispatch()
                const seconds = renderer.totalFrames / sampleRate
                const ppqn = tempoMap.secondsToPPQN(seconds)
                shadertoyState.setPPQN(ppqn)
                shadertoyRunner.render(seconds)

                compositionCtx.drawImage(shadertoyCanvas, 0, 0)

                if (overlay !== undefined) {
                    overlay.render(ppqn)
                    compositionCtx.globalCompositeOperation = "screen"
                    compositionCtx.drawImage(overlay.canvas, 0, 0)
                    compositionCtx.globalCompositeOperation = "source-over"
                }

                const timestampSeconds = frameIndex / frameRate
                await wait(exporter.addFrame(compositionCanvas, channels, timestampSeconds))
                frameIndex++
            }

            signal.throwIfAborted()
            dialog.message = "Finalizing video..."
            await wait(exporter.finalize())
            signal.throwIfAborted()
            completed = true
        } catch (error) {
            failed = true
            failure = error
        } finally {
            if (!completed) {
                controller.abort(failure ?? new DOMException("Video export was aborted.", "AbortError"))
                abortExporter()
                abortWritable()
            }
            release()
            signal.removeEventListener("abort", retire)
            console.timeEnd("Render Video")
        }
        if (failed && !cancelled) {
            await notifyFailure(failure)
            throw failure
        }
    }
}
