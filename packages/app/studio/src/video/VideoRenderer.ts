import {
    asInstanceOf,
    DefaultObservableValue,
    isDefined,
    Option,
    panic,
    RuntimeNotifier,
    TimeSpan
} from "@opendaw/lib-std"
import {dbToGain, ppqn, RenderQuantum} from "@opendaw/lib-dsp"
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
import {validateVideoConfig} from "./VideoExportLimits"
import {Promises} from "@opendaw/lib-runtime"

const SILENCE_THRESHOLD_DB = -72.0
const SILENCE_DURATION_SECONDS = 10

const isAllocationError = (error: unknown): boolean =>
    error instanceof RangeError && /alloc|array|memory/i.test(error.message)

export namespace VideoRenderer {
    export const render = async (source: Project, projectName: string, sampleRate: number): Promise<void> => {
        if (!WebCodecsVideoExporter.isSupported()) {
            return panic("WebCodecs is not supported in this browser")
        }
        const config = await showVideoExportDialog(sampleRate)
        const {width, height, frameRate, duration, overlay: overlayEnabled, videoBitrate} = config
        const exportConfig = {width, height, frameRate, sampleRate, numberOfChannels: 2, videoBitrate}
        validateVideoConfig(exportConfig, duration)
        const arrangementEnd = source.tempoMap.ppqnToSeconds(source.lastRegionAction())
        if (!Number.isFinite(arrangementEnd) || arrangementEnd < 0) {throw new Error("Invalid arrangement duration.")}
        const maxDuration = duration > 0 ? duration : arrangementEnd + SILENCE_DURATION_SECONDS
        validateVideoConfig(exportConfig, maxDuration)
        let exporter: VideoExporter
        if (isDefined(window.showSaveFilePicker)) {
            const result = await Promises.tryCatch(
                window.showSaveFilePicker({suggestedName: "opendaw-video.mp4"})
            )
            if (result.status === "rejected") {return}
            const writable = await result.value.createWritable()
            exporter = await Promises.timeout(
                StreamVideoExporter.create(exportConfig, writable), TimeSpan.seconds(10))
        } else {
            exporter = await Promises.timeout(
                BufferVideoExporter.create(exportConfig), TimeSpan.seconds(10))
        }
        console.time("Render Video")
        let project: Project | undefined
        let renderer: OfflineEngineRenderer | undefined
        let shadertoyState: ShadertoyState | undefined
        let shadertoyRunner: ShadertoyRunner | undefined
        let overlay: VideoOverlay | undefined
        let shadertoyContext: WebGL2RenderingContext | null = null
        let dialog: ReturnType<typeof RuntimeNotifier.progress> | undefined
        let active = true
        let completed = false
        let failed = false
        let failure: unknown
        const progressValue = new DefaultObservableValue(0.0)
        try {
            dialog = RuntimeNotifier.progress({
                headline: "Rendering video...",
                progress: progressValue,
                cancel: () => active = false
            })
            project = source.copy()
            const {boxGraph, timelineBox: {loopArea: {enabled}}} = project
            boxGraph.beginTransaction()
            try {enabled.setValue(false)} finally {boxGraph.endTransaction()}
            dialog.message = "Initializing..."
            const estimator = TimeSpan.createEstimator()
            const shadertoyCanvas = new OffscreenCanvas(width, height)
            shadertoyContext = shadertoyCanvas.getContext("webgl2")!
            shadertoyState = new ShadertoyState(project)
            shadertoyRunner = new ShadertoyRunner(shadertoyState, shadertoyContext)
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
            overlay = await VideoOverlay.create({
                width, height, projectName,
                toParts: (position: ppqn) => signatureTrack.toParts(position)
            })

            renderer = await OfflineEngineRenderer.create(project, Option.None, sampleRate)
            await renderer.play()

            const tempoMap = project.tempoMap
            const estimatedDurationInSeconds = duration > 0
                ? duration
                : tempoMap.ppqnToSeconds(project.lastRegionAction())
            const maxFrames = Math.ceil(maxDuration * frameRate)
            const estimatedNumberOfFrames = Math.ceil(estimatedDurationInSeconds * frameRate)

            const silenceThreshold = dbToGain(SILENCE_THRESHOLD_DB)
            const silenceSamplesNeeded = Math.ceil(SILENCE_DURATION_SECONDS * sampleRate)
            let consecutiveSilentSamples = 0

            const idealSamplesPerFrame = sampleRate / frameRate
            let samplesRendered = 0
            let frameIndex = 0

            while (frameIndex < maxFrames && active) {
                if (frameIndex >= estimatedNumberOfFrames) {
                    dialog.message = `Waiting for silence...`
                } else {
                    const progress = frameIndex / estimatedNumberOfFrames
                    dialog.message = `Frame ${frameIndex + 1} / ${estimatedNumberOfFrames} (${estimator(progress)})`
                    progressValue.setValue(progress)
                }

                const targetSamples = Math.round((frameIndex + 1) * idealSamplesPerFrame)
                const samplesToRender = targetSamples - samplesRendered
                const quantumsNeeded = Math.ceil(samplesToRender / RenderQuantum)
                const actualSamplesToRender = quantumsNeeded * RenderQuantum
                const channels = await renderer.step(actualSamplesToRender)
                samplesRendered += actualSamplesToRender
                project.liveStreamReceiver.dispatch()
                if (duration === 0) {
                    let maxSample = 0
                    for (const channel of channels) {
                        for (const sample of channel) {
                            const absoluteValue = Math.abs(sample)
                            if (absoluteValue > maxSample) {maxSample = absoluteValue}
                        }
                    }
                    if (maxSample > silenceThreshold) {
                        consecutiveSilentSamples = 0
                    } else if (samplesRendered / sampleRate >= arrangementEnd) {
                        consecutiveSilentSamples += Math.min(actualSamplesToRender,
                            Math.max(0, samplesRendered - Math.ceil(arrangementEnd * sampleRate)))
                    }
                }

                const seconds = renderer.totalFrames / sampleRate
                const ppqn = tempoMap.secondsToPPQN(seconds)
                shadertoyState.setPPQN(ppqn)
                shadertoyRunner.render(seconds)

                compositionCtx.drawImage(shadertoyCanvas, 0, 0)

                if (overlayEnabled) {
                    overlay.render(ppqn)
                    compositionCtx.globalCompositeOperation = "screen"
                    compositionCtx.drawImage(overlay.canvas, 0, 0)
                    compositionCtx.globalCompositeOperation = "source-over"
                }

                const timestampSeconds = frameIndex / frameRate
                await exporter.addFrame(compositionCanvas, channels, timestampSeconds)
                frameIndex++
                if (duration === 0 && consecutiveSilentSamples >= silenceSamplesNeeded) {break}
            }

            if (active) {
                dialog.message = "Finalizing video..."
                await exporter.finalize()
                completed = true
            }
        } catch (error) {
            failed = true
            failure = error
        } finally {
            // Every acquired owner gets an independent cleanup attempt.
            for (const close of [
                () => renderer?.stop(),
                () => renderer?.terminate(),
                () => overlay?.terminate(),
                () => shadertoyRunner?.terminate(),
                () => shadertoyState?.terminate(),
                () => shadertoyContext?.getExtension?.("WEBGL_lose_context")?.loseContext(),
                () => project?.terminate(),
                () => dialog?.terminate()
            ]) {
                try {close()} catch {console.warn("Video render cleanup failed")}
            }
            if (!completed) {
                try {await exporter.abort()} catch {console.warn("Video export abort failed")}
            }
            console.timeEnd("Render Video")
        }
        if (failed) {
            const message = isAllocationError(failure)
                ? "Video is too large for this browser. Please use Chrome."
                : String(failure)
            try {
                await RuntimeNotifier.info({headline: "Video Export Failed", message})
            } catch {console.warn("Video failure notification failed")}
            throw failure
        }
    }
}
