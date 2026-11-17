import css from "./AudioEditorCanvas.sass?inline"
import {isDefined, Lifecycle, Nullable, ObservableValue, Option, Terminator} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {AudioRenderer, CanvasPainter, Project, TimelineRange} from "@opendaw/studio-core"
import {LoopableRegion, ppqn} from "@opendaw/lib-dsp"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {renderTimeGrid} from "@/ui/timeline/editors/TimeGridRenderer.ts"
import {AudioEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader.ts"
import {installEditorBody} from "../EditorBody"
import {Dragging, Html} from "@opendaw/lib-dom"
import {createAudioCapturing} from "@/ui/timeline/editors/audio/AudioCapturing"
import {installCursor} from "@/ui/hooks/cursor"
import {Cursor} from "@/ui/Cursors"
import {AudioEditorGestures} from "@/ui/timeline/editors/audio/AudioEditorGestures"

const className = Html.adoptStyleSheet(css, "AudioEditorCanvas")

type Construct = {
    lifecycle: Lifecycle
    project: Project
    range: TimelineRange
    snapping: Snapping
    reader: AudioEventOwnerReader
    cursorModel: ObservableValue<Nullable<ppqn>>
}

export const AudioEditorCanvas = ({
                                      lifecycle,
                                      project: {editing, timelineBoxAdapter: {signatureTrack}},
                                      range,
                                      cursorModel,
                                      snapping,
                                      reader
                                  }: Construct) => {
    const {audioContent: {file, observableOptPlayMode, waveformOffset, gain}} = reader
    return (
        <div className={className}>
            <canvas tabIndex={-1} onInit={canvas => {
                const capturing = createAudioCapturing(canvas, range, reader)
                const painter = lifecycle.own(new CanvasPainter(canvas, painter => {
                    const {context, actualHeight, devicePixelRatio} = painter
                    renderTimeGrid(context, signatureTrack, range, snapping, 0, actualHeight)
                    const x0 = Math.floor(range.unitToX(reader.offset) * devicePixelRatio)
                    const x1 = Math.floor(range.unitToX(reader.offset + reader.loopDuration) * devicePixelRatio)
                    if (x0 > 0) {
                        context.fillStyle = `hsla(${reader.hue}, 60%, 60%, 0.30)`
                        context.fillRect(x0, 0, devicePixelRatio, actualHeight)
                    }
                    if (x1 > 0) {
                        context.fillStyle = `hsla(${reader.hue}, 60%, 60%, 0.03)`
                        context.fillRect(x0, 0, x1 - x0, actualHeight)
                        context.fillStyle = `hsla(${reader.hue}, 60%, 60%, 0.30)`
                        context.fillRect(x1, 0, devicePixelRatio, actualHeight)
                    }

                    const pass = LoopableRegion.locateLoop(reader, range.unitMin - range.unitPadding, range.unitMax)
                    if (pass.isEmpty()) {return}
                    const tempoMap = reader.trackBoxAdapter.unwrap().context.tempoMap
                    AudioRenderer.render(context, range, file, tempoMap, observableOptPlayMode, waveformOffset.getValue(),
                        gain.getValue(), {top: 0, bottom: painter.height},
                        `hsl(${reader.hue}, ${60}%, 45%)`, pass.unwrap(), false)

                    const cursor = cursorModel.getValue()
                    if (isDefined(cursor)) {
                        const x = Math.floor(range.unitToX(cursor + reader.offset) * devicePixelRatio)
                        context.fillStyle = `rgba(255, 255, 255, 0.5)`
                        context.fillRect(x, 0, devicePixelRatio, actualHeight)
                    }
                }))
                const playModeTerminator = lifecycle.own(new Terminator())
                const gestures: AudioEditorGestures.Construct = {editing, range, snapping, reader}
                lifecycle.ownAll(
                    installEditorBody({element: canvas, range, reader}),
                    installCursor(canvas, capturing, {
                        get: (target) =>
                            target?.type === "loop-duration" && target?.reader.audioContent.canResize
                                ? Cursor.ExpandWidth : null
                    }),
                    cursorModel.subscribe(painter.requestUpdate),
                    reader.subscribeChange(painter.requestUpdate),
                    observableOptPlayMode.catchupAndSubscribe((optPlayMode) => {
                        playModeTerminator.terminate()
                        optPlayMode.ifSome(playMode => playModeTerminator.own(playMode.subscribe(painter.requestUpdate)))
                    }),
                    range.subscribe(painter.requestUpdate),
                    snapping.subscribe(painter.requestUpdate),
                    Dragging.attach(canvas, event => {
                        const target = capturing.captureEvent(event)
                        if (target?.type !== "loop-duration") {return Option.None}
                        return AudioEditorGestures.resizeLoop(gestures, event)
                    }, {permanentUpdates: true}),
                    Dragging.attach(canvas, startEvent => AudioEditorGestures.slipWaveform(gestures, canvas, startEvent))
                )
            }}/>
        </div>
    )
}