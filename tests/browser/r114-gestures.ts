import {DefaultObservableValue, Option, Terminable, UUID, ValueAxis} from "@opendaw/lib-std"
import {BoxEditing} from "@opendaw/lib-box"
import {EventCollection, Interpolation} from "@opendaw/lib-dsp"
import {AudioTimeStretchBox, WarpMarkerBox, NoteEventCollectionBox, NoteEventBox,
    ValueEventCollectionBox, ValueEventBox, ValueEventCurveBox,
    AudioRegionBox, AudioFileBox, NoteRegionBox, ValueRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {AudioTimeStretchBoxAdapter, NoteEventBoxAdapter, NoteEventCollectionBoxAdapter,
    ValueEventBoxAdapter, ValueEventCollectionBoxAdapter, TransientMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {Project, ProjectEnv} from "@opendaw/studio-core"
import {WarpMarkerEditing} from "@/ui/timeline/editors/audio/WarpMarkerEditing"
import {NoteMoveModifier} from "@/ui/timeline/editors/notes/NoteMoveModifier"
import {ValueSlopeModifier} from "@/ui/timeline/editors/value/ValueSlopeModifier"
import {Dragging} from "@opendaw/lib-dom"

const newProject = () => Project.new({sampleManager: {
    register: () => Terminable.Empty,
    getOrCreate: () => ({subscribe: () => Terminable.Empty})
}} as unknown as ProjectEnv)

const canvas = () => {
    const element = document.createElement("canvas")
    element.id = "gesture"
    element.style.cssText = "position:fixed;left:0;top:0;width:600px;height:100px"
    document.body.append(element)
    return element
}

export const setupWarp = () => {
    const project = newProject()
    const {editing, boxGraph, boxAdapters} = project
    const box = editing.modify(() => {
        const track = TrackBox.create(boxGraph, UUID.generate(), track => {
            track.tracks.refer(project.primaryAudioUnitBox.tracks); track.target.refer(project.primaryAudioUnitBox)
        })
        const mode = AudioTimeStretchBox.create(boxGraph, UUID.generate())
        const file = AudioFileBox.create(boxGraph, UUID.generate())
        const events = ValueEventCollectionBox.create(boxGraph, UUID.generate())
        AudioRegionBox.create(boxGraph, UUID.generate(), region => {
            region.regions.refer(track.regions); region.file.refer(file)
            region.events.refer(events.owners); region.playMode.refer(mode)
        })
        for (const position of [0, 1000, 2000]) {
            WarpMarkerBox.create(boxGraph, UUID.generate(), marker => {
                marker.owner.refer(mode.warpMarkers); marker.position.setValue(position); marker.seconds.setValue(position / 1000)
            })
        }
        return mode
    }).unwrap()
    const mode = boxAdapters.adapterFor(box, AudioTimeStretchBoxAdapter)
    const add = (position: number) => editing.modify(() => WarpMarkerBox.create(boxGraph, UUID.generate(), marker => {
        marker.owner.refer(box.warpMarkers); marker.position.setValue(position); marker.seconds.setValue(position / 1000)
    })).unwrap()
    const target = mode.warpMarkers.asArray().find(marker => marker.position === 1000)!.box
    const element = canvas()
    const reader = {offset: 0, audioContent: {optWarpMarkers: Option.wrap(mode.warpMarkers),
        observableOptPlayMode: Option.wrap(mode), waveformOffset: {getValue: () => 0},
        file: {transients: EventCollection.create<TransientMarkerBoxAdapter>()}}}
    let preview: WarpMarkerEditing.Preview = null
    const owner = WarpMarkerEditing.install(project, element,
        {xToUnit: (x: number) => x * 4, unitToX: (unit: number) => unit / 4} as Parameters<typeof WarpMarkerEditing.install>[2],
        {xToUnitRound: (x: number) => x * 4} as Parameters<typeof WarpMarkerEditing.install>[3],
        reader as unknown as Parameters<typeof WarpMarkerEditing.install>[4], mode, new DefaultObservableValue(null),
        value => {preview = value})
    ;(editing as BoxEditing).clear()
    return {
        read: () => ({position: target.position.getValue(), preview: preview?.position ?? null, undo: editing.canUndo()}),
        external: () => editing.modify(() => target.position.setValue(1100)),
        insert: () => add(1500),
        undo: () => editing.undo(),
        dispose: () => owner.terminate(),
        close: () => {owner.terminate(); project.terminate(); element.remove()}
    }
}

export const noteAndSlope = () => {
    const project = newProject()
    const {editing, boxGraph, boxAdapters} = project
    const element = canvas()
    try {
        const track = editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), track => {
            track.tracks.refer(project.primaryAudioUnitBox.tracks); track.target.refer(project.primaryAudioUnitBox)
        })).unwrap()
        const collectionBox = editing.modify(() => {
            const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
            NoteRegionBox.create(boxGraph, UUID.generate(), region => {
                region.events.refer(collection.owners); region.regions.refer(track.regions)
            })
            return collection
        }).unwrap()
        const collection = boxAdapters.adapterFor(collectionBox, NoteEventCollectionBoxAdapter)
        const notes = [2, 6, 90].map(pitch => editing.modify(() => NoteEventBox.create(boxGraph, UUID.generate(), box => {
            box.events.refer(collectionBox.events); box.pitch.setValue(pitch); box.duration.setValue(100)
        })).map(box => boxAdapters.adapterFor(box, NoteEventBoxAdapter)).unwrap())
        const selection = project.selection.createFilteredSelection(box => box instanceof NoteEventBox, {
            fx: (adapter: NoteEventBoxAdapter) => adapter.box,
            fy: vertex => boxAdapters.adapterFor(vertex.box, NoteEventBoxAdapter)
        })
        selection.select(notes[0], notes[1])
        const construct = {editing, element, selection, pointerPulse: 0, pointerPitch: 2, reference: notes[0],
            positioner: {yToPitch: (y: number) => y}, snapping: {computeDelta: () => 10}}
        const move = NoteMoveModifier.create(construct as unknown as Parameters<typeof NoteMoveModifier.create>[0])
        const audition: number[] = []
        move.subscribePitchChanged(pitch => audition.push(pitch))
        selection.deselectAll(); selection.select(notes[2])
        move.update({clientX: 10, clientY: -10, ctrlKey: false, shiftKey: false, altKey: false})
        const preview = notes.map(note => (move.isSelected(note) ? move.selectedModifyStrategy() : move.unselectedModifyStrategy()).readPitch(note))
        move.approve()
        const committed = notes.map(note => note.pitch)
        editing.undo()
        const restored = notes.map(note => note.pitch)
        selection.terminate()

        const valuesBox = editing.modify(() => {
            const collection = ValueEventCollectionBox.create(boxGraph, UUID.generate())
            ValueRegionBox.create(boxGraph, UUID.generate(), region => {
                region.events.refer(collection.owners); region.regions.refer(track.regions)
            })
            return collection
        }).unwrap()
        const values = boxAdapters.adapterFor(valuesBox, ValueEventCollectionBoxAdapter)
        const points = [0, 1].map((value, index) => editing.modify(() => ValueEventBox.create(boxGraph, UUID.generate(), box => {
            box.events.refer(valuesBox.events); box.position.setValue(index * 100); box.value.setValue(value)
            box.interpolation.setValue(1)
        })).map(box => boxAdapters.adapterFor(box, ValueEventBoxAdapter)).unwrap())
        const slope = () => ValueSlopeModifier.create({editing, element, pointerY: 100,
            valueAxis: {valueToAxis: (v: number) => v * 100} as ValueAxis, reference: points[0], collection: values})
        const first = slope()
        first.update({clientY: 120, altKey: false} as Dragging.Event)
        first.approve()
        const oneMotion = points[0].interpolation.type === "curve"
        const stale = slope()
        stale.update({clientY: 130, altKey: false} as Dragging.Event)
        // Mutate the separately owned curve box, then restore its numeric value.
        const curve = boxGraph.boxes().find(box => box instanceof ValueEventCurveBox) as ValueEventCurveBox
        const original = curve.slope.getValue()
        editing.modify(() => curve.slope.setValue(0.2))
        editing.modify(() => curve.slope.setValue(original))
        const before = points[0].interpolation
        stale.approve()
        const preserved = JSON.stringify(before) === JSON.stringify(points[0].interpolation)
        const inserted = slope()
        inserted.update({clientY: 140, altKey: false} as Dragging.Event)
        editing.modify(() => ValueEventBox.create(boxGraph, UUID.generate(), box => {
            box.events.refer(valuesBox.events); box.position.setValue(50); box.value.setValue(0.5)
        }))
        inserted.approve()
        const segmentPreserved = JSON.stringify(before) === JSON.stringify(points[0].interpolation)
        return {preview, committed, restored, audition, oneMotion, preserved, segmentPreserved,
            contentCount: collection.events.length(), linear: Interpolation.Linear.type}
    } finally {project.terminate(); element.remove()}
}
