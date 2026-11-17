import {Terminable, UUID, ValueAxis} from "@opendaw/lib-std"
import {Project, ProjectEnv} from "@opendaw/studio-core"
import {NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {NoteEventBoxAdapter} from "@opendaw/studio-adapters"
import {NoteDurationModifier} from "./NoteDurationModifier"
import {PropertyNodeModifier} from "./property/PropertyNodeModifier"
import {NotePropertyVelocity, PropertyAccessor} from "./property/PropertyAccessor"

export const noteGestureFixture = (property?: PropertyAccessor, element = document.createElement("canvas")) => {
    const project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    const {editing, boxGraph, boxAdapters} = project
    const {collection, track} = editing.modify(() => {
        const track = TrackBox.create(boxGraph, UUID.generate(), track => {
            track.tracks.refer(project.primaryAudioUnitBox.tracks); track.target.refer(project.primaryAudioUnitBox)
        })
        const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
        NoteRegionBox.create(boxGraph, UUID.generate(), region => {
            region.events.refer(collection.owners); region.regions.refer(track.regions)
        })
        return {collection, track}
    }).unwrap()
    const notes = [0, 1, 2, 3].map(index => editing.modify(() => NoteEventBox.create(boxGraph, UUID.generate(), box => {
        box.events.refer(collection.events); box.position.setValue(index * 2); box.duration.setValue(10 + index * 10)
        box.velocity.setValue(0.5 + index / 10); box.chance.setValue(50 + index * 10); box.cent.setValue(index * 10)
    })).map(box => boxAdapters.adapterFor(box, NoteEventBoxAdapter)).unwrap())
    const selection = project.selection.createFilteredSelection(box => box instanceof NoteEventBox, {
        fx: (adapter: NoteEventBoxAdapter) => adapter.box,
        fy: vertex => boxAdapters.adapterFor(vertex.box, NoteEventBoxAdapter)
    })
    selection.select(...notes.slice(0, 3))
    const tool = property ? PropertyNodeModifier.create({editing, element, selection, property,
        valueAxis: {axisToValue: (y: number) => y / 100} as ValueAxis, pointerValue: 0})
        : NoteDurationModifier.create({editing, element, selection, pointerPulse: 0, reference: notes[0],
            snapping: {computeDelta: (_pulse: number, x: number) => x, value: () => 1} as unknown as Parameters<typeof NoteDurationModifier.create>[0]["snapping"]})
    const accessor = property ?? NotePropertyVelocity
    const preview = () => notes.map(note => {
        const strategy = (tool.isSelected?.(note) ?? note.isSelected) ? tool.selectedModifyStrategy() : tool.unselectedModifyStrategy()
        return property ? accessor.readValue(strategy, note) : strategy.readComplete(note) - strategy.readPosition(note)
    })
    return {project, editing, notes, tool, selection, preview,
        read: () => notes.map(note => property ? accessor.readRawValue(note) : note.duration),
        swap: () => {selection.deselectAll(); selection.select(notes[3])},
        reparent: () => editing.modify(() => {
            const other = NoteEventCollectionBox.create(boxGraph, UUID.generate())
            NoteRegionBox.create(boxGraph, UUID.generate(), region => {
                region.events.refer(other.owners); region.regions.refer(track.regions)
            })
            notes[1].box.events.refer(other.events)
        }),
        detach: () => editing.modify(() => notes[1].box.delete()),
        close: () => {selection.terminate(); project.terminate()}}
}
