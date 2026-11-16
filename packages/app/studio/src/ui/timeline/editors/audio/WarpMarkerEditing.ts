import {
    AudioPlayMode,
    FilteredSelection,
    TransientMarkerBoxAdapter,
    WarpMarkerBoxAdapter
} from "@opendaw/studio-adapters"
import {ContextMenu, MenuItem, Project, TimelineRange} from "@opendaw/studio-core"
import {AudioEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader"
import {WarpMarkerBox} from "@opendaw/studio-boxes"
import {
    clamp,
    isNotNull,
    isNull,
    Nullable,
    ObservableValue,
    Option,
    Procedure,
    Terminable,
    Terminator,
    UUID
} from "@opendaw/lib-std"
import {DebugMenus} from "@/ui/menu/debug"
import {WarpMarkerUtils} from "@/ui/timeline/editors/audio/WarpMarkerUtils"
import {Dragging, Events, Keyboard} from "@opendaw/lib-dom"
import {PPQN} from "@opendaw/lib-dsp"
import {TransientMarkerUtils} from "./TransientMarkerUtils"
import {Snapping} from "@/ui/timeline/Snapping"

export namespace WarpMarkerEditing {
    export const MIN_DISTANCE = PPQN.SemiQuaver

    export type Preview = Nullable<{marker: WarpMarkerBoxAdapter, position: number}>

    const MARKER_RADIUS = 4

    export const install = (project: Project,
                            canvas: HTMLCanvasElement,
                            range: TimelineRange,
                            snapping: Snapping,
                            reader: AudioEventOwnerReader,
                            audioPlayMode: AudioPlayMode,
                            hoverTransient: ObservableValue<Nullable<TransientMarkerBoxAdapter>>,
                            preview: Procedure<Preview> = () => {}): Terminable => {
        const terminator = new Terminator()
        const capturing = WarpMarkerUtils.createCapturing(canvas, range, reader, MARKER_RADIUS)
        const warpMarkersField = reader.audioContent.observableOptPlayMode.map(playMode => playMode.box.warpMarkers)
        const selection: FilteredSelection<WarpMarkerBoxAdapter> = terminator.own(
            project.selection
                .createFilteredSelection(box => box instanceof WarpMarkerBox
                    && box.owner.targetVertex.equals(warpMarkersField), {
                    fx: adapter => adapter.box,
                    fy: vertex => project.boxAdapters.adapterFor(vertex.box, WarpMarkerBoxAdapter)
                }))
        const {warpMarkers, box: audioPlayModeBox} = audioPlayMode
        const {audioContent: {waveformOffset}} = reader
        terminator.ownAll(
            selection.catchupAndSubscribe({
                onSelected: (adapter: WarpMarkerBoxAdapter) => adapter.onSelected(),
                onDeselected: (adapter: WarpMarkerBoxAdapter) => adapter.onDeselected()
            }),
            ContextMenu.subscribe(canvas, collector => {
                const marker = capturing.captureEvent(collector.client)
                if (isNotNull(marker)) {
                    selection.deselectAll()
                    selection.select(marker)
                    collector.addItems(
                        MenuItem.default({
                            label: "Remove warp marker",
                            selectable: !marker.isAnchor
                        }).setTriggerProcedure(() => {
                            project.editing.modify(() => selection.selected()
                                .filter(marker => !marker.isAnchor)
                                .forEach(marker => marker.box.delete()))
                        }),
                        DebugMenus.debugBox(marker.box, true)
                    )
                }
            }),
            Events.subscribeDblDwn(canvas, event => {
                const marker = capturing.captureEvent(event)
                if (isNotNull(marker)) {
                    if (!marker.isAnchor) {
                        project.editing.modify(() => marker.box.delete())
                    }
                } else {
                    if (!TransientMarkerUtils.isValidWarpMarkers(warpMarkers.asArray())) {return}
                    const transient = hoverTransient.getValue()
                    if (isNull(transient)) {
                        const rect = canvas.getBoundingClientRect()
                        const x = event.clientX - rect.left
                        const unit = event.shiftKey ? range.xToUnit(x) : snapping.xToUnitRound(x)
                        const local = unit - reader.offset
                        if (!Number.isFinite(local)) {return}
                        const adjacentWarpMarkers = WarpMarkerUtils.findAdjacent(local, warpMarkers, true)
                        if (isNull(adjacentWarpMarkers)) {return}
                        const [left, right] = adjacentWarpMarkers
                        if (isNull(left) || isNull(right)) {return}
                        if (local - left.position < MIN_DISTANCE || right.position - local < MIN_DISTANCE) {return}
                        const clamped = clamp(local, left.position + MIN_DISTANCE, right.position - MIN_DISTANCE)
                        const alpha = (clamped - left.position) / (right.position - left.position)
                        const seconds = left.seconds + alpha * (right.seconds - left.seconds)
                        if (!Number.isFinite(seconds)) {return}
                        project.editing.modify(() => WarpMarkerBox.create(project.boxGraph, UUID.generate(), box => {
                            box.owner.refer(audioPlayMode.box.warpMarkers)
                            box.position.setValue(local)
                            box.seconds.setValue(seconds)
                        }))
                    } else {
                        if (!transient.box.isAttached() || !reader.audioContent.file.transients.contains(transient)) {return}
                        const adjustedSeconds = transient.position - waveformOffset.getValue()
                        const position = TransientMarkerUtils.secondsToUnits(adjustedSeconds, warpMarkers)
                        if (isNull(position)) {return}
                        const [adjLeft, adjRight] = WarpMarkerUtils.findAdjacent(position, warpMarkers, true)
                        if (isNull(adjLeft) || isNull(adjRight)) {return}
                        if (position - adjLeft.position < MIN_DISTANCE || adjRight.position - position < MIN_DISTANCE) {return}
                        project.editing.modify(() => WarpMarkerBox.create(project.boxGraph, UUID.generate(), box => {
                            box.owner.refer(audioPlayModeBox.warpMarkers)
                            box.position.setValue(position)
                            box.seconds.setValue(adjustedSeconds)
                        }))
                    }
                }
            }),
            Events.subscribe(canvas, "keydown", (event) => {
                if (Keyboard.isDelete(event)) {
                    project.editing.modify(() => selection.selected()
                        .filter(marker => !marker.isAnchor)
                        .forEach(marker => marker.box.delete()))
                }
            }),
            Dragging.attach(canvas, startEvent => {
                const marker = capturing.captureEvent(startEvent)
                selection.deselectAll()
                if (isNull(marker)) {return Option.None}
                selection.select(marker)
                const initialPosition = marker.position
                const initialSeconds = marker.seconds
                let proposed: Nullable<number> = null
                let settled = false
                const currentPosition = (local: number): Nullable<number> => {
                    if (!marker.box.isAttached() || !warpMarkers.contains(marker)
                        || marker.position !== initialPosition || marker.seconds !== initialSeconds
                        || !Number.isFinite(local)) {return null}
                    const [left, right] = WarpMarkerUtils.findAdjacent(marker.position, warpMarkers, false)
                    if (isNull(left) && isNull(right)) {return null}
                    const min = (left?.position ?? Number.MIN_SAFE_INTEGER) + MIN_DISTANCE
                    const max = (right?.position ?? Number.MAX_SAFE_INTEGER) - MIN_DISTANCE
                    return min <= max ? clamp(local, min, max) : null
                }
                return Option.wrap({
                    update: (event: Dragging.Event) => {
                        if (settled) {return}
                        const rect = canvas.getBoundingClientRect()
                        const x = event.clientX - rect.left
                        const unit = event.shiftKey ? range.xToUnit(x) : snapping.xToUnitRound(x)
                        proposed = currentPosition(unit - reader.offset)
                        preview(isNull(proposed) ? null : {marker, position: proposed})
                    },
                    approve: () => {
                        if (settled) {return}
                        settled = true
                        const position = isNull(proposed) ? null : currentPosition(proposed)
                        preview(null)
                        if (!isNull(position) && position !== initialPosition) {
                            project.editing.modify(() => marker.box.position.setValue(position))
                        }
                    },
                    cancel: () => {
                        if (settled) {return}
                        settled = true
                        preview(null)
                    }
                })
            }))
        return terminator
    }
}