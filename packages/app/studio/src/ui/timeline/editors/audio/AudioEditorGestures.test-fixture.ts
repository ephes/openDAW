import {Editing, Option, Terminable, UUID} from "@opendaw/lib-std"
import {PrimitiveField} from "@opendaw/lib-box"
import {PPQN, TimeBase} from "@opendaw/lib-dsp"
import {Dragging} from "@opendaw/lib-dom"
import {Project, ProjectEnv, TimelineRange} from "@opendaw/studio-core"
import {AudioClipBoxAdapter, AudioRegionBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {
    AudioClipBox,
    AudioFileBox,
    AudioRegionBox,
    AudioTimeStretchBox,
    TrackBox,
    ValueEventCollectionBox,
    WarpMarkerBox
} from "@opendaw/studio-boxes"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {ClipReader} from "@/ui/timeline/editors/ClipReader.ts"
import {RegionReader} from "@/ui/timeline/editors/RegionReader.ts"
import {AudioEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader.ts"
import {AudioEditorGestures} from "./AudioEditorGestures"

export type AudioGestureOwner = "clip" | "region"
export type AudioGestureKind = "resize" | "slip"

export type AudioGestureValues = {duration: number, offset: number, gain: number, label: string}
export type AudioGestureFixture = {
    editing: Editing
    box: AudioClipBox | AudioRegionBox
    reader: AudioEventOwnerReader
    range: TimelineRange
    durationField: PrimitiveField<number>
    at(unit: number): Dragging.Event
    factory(gesture: AudioGestureKind, event: Dragging.Event, target?: Element): Option<Dragging.Process>
    begin(gesture: AudioGestureKind, unit: number): Dragging.Process
    read(): AudioGestureValues
    close(): void
}

export const audioGestureFixture = (owner: AudioGestureOwner, {duration = PPQN.Bar, timeBase = TimeBase.Musical,
    snapping: snappingEnabled = true} = {}): AudioGestureFixture => {
    const project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    const {editing, boxGraph, boxAdapters, timelineBoxAdapter} = project
    const box = editing.modify(() => {
        const track = TrackBox.create(boxGraph, UUID.generate(), track => {
            track.type.setValue(TrackType.Audio)
            track.tracks.refer(project.primaryAudioUnitBox.tracks); track.target.refer(project.primaryAudioUnitBox)
        })
        const file = AudioFileBox.create(boxGraph, UUID.generate(), file => {
            file.startInSeconds.setValue(0); file.endInSeconds.setValue(4)
        })
        const events = ValueEventCollectionBox.create(boxGraph, UUID.generate())
        const playMode = AudioTimeStretchBox.create(boxGraph, UUID.generate())
        for (const [position, seconds] of [[0, 0], [PPQN.Bar * 2, 4]]) {
            WarpMarkerBox.create(boxGraph, UUID.generate(), marker => {
                marker.owner.refer(playMode.warpMarkers); marker.position.setValue(position); marker.seconds.setValue(seconds)
            })
        }
        return owner === "clip"
            ? AudioClipBox.create(boxGraph, UUID.generate(), clip => {
                clip.clips.refer(track.clips); clip.file.refer(file); clip.events.refer(events.owners)
                clip.playMode.refer(playMode); clip.timeBase.setValue(timeBase); clip.duration.setValue(duration)
                clip.label.setValue("before")
            })
            : AudioRegionBox.create(boxGraph, UUID.generate(), region => {
                region.regions.refer(track.regions); region.file.refer(file); region.events.refer(events.owners)
                region.playMode.refer(playMode); region.timeBase.setValue(timeBase); region.position.setValue(0)
                region.duration.setValue(duration); region.loopDuration.setValue(duration); region.label.setValue("before")
            })
    }).unwrap()
    editing.modify(() => box.label.setValue("marked"))
    const reader: AudioEventOwnerReader = owner === "clip"
        ? ClipReader.forAudioClipBoxAdapter(boxAdapters.adapterFor(box as AudioClipBox, AudioClipBoxAdapter), timelineBoxAdapter)
        : RegionReader.forAudioRegionBoxAdapter(boxAdapters.adapterFor(box as AudioRegionBox, AudioRegionBoxAdapter), timelineBoxAdapter)
    const range = new TimelineRange()
    range.maxUnits = PPQN.Bar * 8
    range.width = 1000
    range.showUnitInterval(0, PPQN.Bar * 2)
    const realSnapping = new Snapping(range)
    const snapping = snappingEnabled ? realSnapping : {
        computeDelta: (pointer: number, x: number) => range.xToUnit(x) - pointer
    } as unknown as Snapping
    const construct: AudioEditorGestures.Construct = {editing, range, snapping, reader}
    const element = document.createElement("canvas")
    const durationField: PrimitiveField<number> = box instanceof AudioRegionBox ? box.loopDuration : box.duration
    const at = (unit: number) => ({clientX: range.unitToX(unit), clientY: 0, altKey: false, shiftKey: false, ctrlKey: false})
    const factory = (gesture: AudioGestureKind, event: Dragging.Event, target: Element = element) => gesture === "resize"
        ? AudioEditorGestures.resizeLoop(construct, event)
        : AudioEditorGestures.slipWaveform(construct, target, event)
    const begin = (gesture: AudioGestureKind, unit: number): Dragging.Process => factory(gesture, at(unit)).unwrap()
    const read = () => ({duration: durationField.getValue(), offset: box.waveformOffset.getValue(),
        gain: box.gain.getValue(), label: box.label.getValue()})
    return {editing, box, reader, range, durationField, at, factory, begin, read,
        close: () => {realSnapping.terminate(); project.terminate()}}
}
