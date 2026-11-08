import {describe, expect, it, vi} from "vitest"
import {ByteArrayOutput, Selection, UUID} from "@opendaw/lib-std"
import {BoxEditing} from "@opendaw/lib-box"
import {AudioUnitBox, NoteEventBox, NoteEventCollectionBox, NoteEventRepeatBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {BoxAdapters, NoteEventBoxAdapter, ProjectSkeleton, TrackType} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {ClipboardUtils} from "../ClipboardUtils"
import {NotesClipboard} from "./NotesClipboardHandler"

const project = () => {
    const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} = skeleton
    boxGraph.beginTransaction()
    const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Instrument)
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
    })
    const track = TrackBox.create(boxGraph, UUID.generate(), box => {
        box.tracks.refer(unit.tracks)
        box.target.refer(unit)
        box.type.setValue(TrackType.Notes)
    })
    const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
    NoteRegionBox.create(boxGraph, UUID.generate(), box => {
        box.regions.refer(track.regions)
        box.events.refer(collection.owners)
    })
    boxGraph.endTransaction()
    return {boxGraph, collection, timeline: skeleton.mandatoryBoxes.timelineBox}
}

const setup = () => {
    const {boxGraph: source, collection, timeline} = project()
    source.beginTransaction()
    const note = NoteEventBox.create(source, UUID.generate(), box => box.events.refer(collection.events))
    const repeat = NoteEventRepeatBox.create(source, UUID.generate(), box => box.event.refer(note))
    source.endTransaction()
    const {boxGraph: target, collection: targetCollection} = project()
    const selected = [{box: note, position: 0, complete: note.duration.getValue()}] as NoteEventBoxAdapter[]
    const selection = {
        selected: () => selected.slice(), nonEmpty: () => selected.length > 0,
        deselectAll: () => {selected.length = 0},
        select: (...adapters: NoteEventBoxAdapter[]) => {selected.push(...adapters)}
    } as unknown as Selection<NoteEventBoxAdapter>
    const setPosition = vi.fn()
    const context: NotesClipboard.Context = {
        getEnabled: () => true, getPosition: () => 960, setPosition,
        editing: new BoxEditing(target), selection, targetAddress: targetCollection.events.address,
        boxGraph: target,
        boxAdapters: {adapterFor: (box: NoteEventBox) => ({box})} as unknown as BoxAdapters
    }
    const metadata = ByteArrayOutput.create()
    metadata.writeFloat(0)
    metadata.writeFloat(note.duration.getValue())
    return {source, target, collection, timeline, note, repeat, context, metadata: metadata.toArrayBuffer(), setPosition}
}

describe("notes clipboard graph shape", () => {
    it("rejects unrelated timeline roots atomically through the notes handler", () => {
        const {source, target, context, metadata, setPosition} = setup()
        const data = ClipboardUtils.serializeBoxes(source.boxes(), metadata)
        const before = new Uint8Array(target.toArrayBuffer())
        expect(() => NotesClipboard.createHandler(context).paste({type: "notes", data})).toThrow()
        expect(new Uint8Array(target.toArrayBuffer())).toEqual(before)
        expect(setPosition).not.toHaveBeenCalled()
    })
    it("rejects an imported collection used to keep note pointers inside the payload", () => {
        const {source, target, collection, note, context, metadata} = setup()
        const data = ClipboardUtils.serializeBoxes([collection, note, ...source.boxes().filter(box => box instanceof NoteRegionBox)], metadata)
        const create = vi.spyOn(target, "createBox")
        const before = new Uint8Array(target.toArrayBuffer())
        expect(() => NotesClipboard.createHandler(context).paste({type: "notes", data})).toThrow()
        expect(new Uint8Array(target.toArrayBuffer())).toEqual(before)
        expect(create).not.toHaveBeenCalled()
    })
    it("rejects a feature that points outside the imported notes", () => {
        const {target, repeat, context, metadata} = setup()
        const data = ClipboardUtils.serializeBoxes([repeat], metadata)
        const create = vi.spyOn(target, "createBox")
        const before = new Uint8Array(target.toArrayBuffer())
        expect(() => NotesClipboard.createHandler(context).paste({type: "notes", data})).toThrow()
        expect(create).not.toHaveBeenCalled()
        expect(new Uint8Array(target.toArrayBuffer())).toEqual(before)
    })
    it("copies through the real handler and pastes notes and their features across graphs", () => {
        const {source, target, note, context} = setup()
        const sourceHandler = NotesClipboard.createHandler({...context, boxGraph: source})
        const entry = sourceHandler.copy().unwrap()
        NotesClipboard.createHandler(context).paste(entry)
        const pasted = target.boxes().filter((box): box is NoteEventBox => box instanceof NoteEventBox)
        expect(pasted).toHaveLength(1)
        expect(pasted[0].position.getValue()).toBe(960)
        expect(pasted[0].events.targetAddress.unwrap().equals(context.targetAddress)).toBe(true)
        expect(UUID.equals(pasted[0].address.uuid, note.address.uuid)).toBe(false)
        const features = target.boxes().filter((box): box is NoteEventRepeatBox => box instanceof NoteEventRepeatBox)
        expect(features).toHaveLength(1)
        expect(features[0].event.targetAddress.unwrap().equals(pasted[0].address)).toBe(true)
    })
})
