import {describe, expect, it, vi} from "vitest"
import {BoxGraph, Update} from "@opendaw/lib-box"
import {Option, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, CaptureAudioBox, BoxIO, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox,
    ValueEventBox, ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {BoxAdapters} from "../BoxAdapters"
import {BoxAdaptersContext} from "../BoxAdaptersContext"
import {NoteRegionBoxAdapter} from "./region/NoteRegionBoxAdapter"
import {ValueRegionBoxAdapter} from "./region/ValueRegionBoxAdapter"
import {NoteEventBoxAdapter} from "./event/NoteEventBoxAdapter"
import {AudioUnitType} from "@opendaw/studio-enums"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {TrackType} from "./TrackType"

const reopen = (bytes: ArrayBufferLike) => {
    const graph = new BoxGraph(Option.wrap(BoxIO.create))
    graph.fromArrayBuffer(bytes)
    return graph
}

const fixture = (type: "note" | "value") => {
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} = ProjectSkeleton.empty({
        createDefaultUser: true, createOutputMaximizer: false
    })
    const context = {boxGraph} as BoxAdaptersContext
    Object.assign(context, {boxAdapters: new BoxAdapters(context)})
    boxGraph.beginTransaction()
    const capture = CaptureAudioBox.create(boxGraph, UUID.generate())
    const audioUnit = AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Instrument)
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.capture.refer(capture)
    })
    const track = TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(type === "note" ? TrackType.Notes : TrackType.Value)
        box.tracks.refer(audioUnit.tracks)
        box.target.refer(audioUnit)
    })
    const create = (position: number, duration: number) => {
        if (type === "note") {
            const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
            NoteEventBox.create(boxGraph, UUID.generate(), box => {
                box.position.setValue(0)
                box.duration.setValue(1)
                box.events.refer(collection.events)
            })
            const region = NoteRegionBox.create(boxGraph, UUID.generate(), box => {
                box.position.setValue(position)
                box.duration.setValue(duration)
                box.loopDuration.setValue(duration)
                box.events.refer(collection.owners)
                box.regions.refer(track.regions)
            })
            return context.boxAdapters.adapterFor(region, NoteRegionBoxAdapter)
        }
        const collection = ValueEventCollectionBox.create(boxGraph, UUID.generate())
        ValueEventBox.create(boxGraph, UUID.generate(), box => {
            box.position.setValue(0)
            box.value.setValue(0.75)
            box.events.refer(collection.events)
        })
        const region = ValueRegionBox.create(boxGraph, UUID.generate(), box => {
            box.position.setValue(position)
            box.duration.setValue(duration)
            box.loopDuration.setValue(duration)
            box.events.refer(collection.owners)
            box.regions.refer(track.regions)
        })
        return context.boxAdapters.adapterFor(region, ValueRegionBoxAdapter)
    }
    return {boxGraph, context, track, create}
}

describe.each(["note", "value"] as const)("%s flatten", type => {
    it("only replaces supplied regions, retaining other selected and unselected overlaps through replay", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const {boxGraph, create} = fixture(type)
        const first = create(0, 16), second = create(4, 4), untouched = create(2, 1), otherSelected = create(5, 1)
        first.onSelected(); second.onSelected(); otherSelected.onSelected()
        boxGraph.endTransaction()
        const before = boxGraph.toArrayBuffer()
        const updates: Update[] = []
        const subscription = boxGraph.subscribeToAllUpdates({onUpdate: update => updates.push(update)})
        boxGraph.beginTransaction()
        const result = first.flatten([first, second]).unwrap()
        boxGraph.endTransaction()
        subscription.terminate()
        expect(untouched.box.isAttached()).toBe(true)
        expect(otherSelected.box.isAttached()).toBe(true)
        expect(first.box.isAttached()).toBe(false)
        expect(second.box.isAttached()).toBe(false)
        const reopened = reopen(before)
        reopened.beginTransaction()
        updates.forEach(update => update.forward(reopened))
        reopened.endTransaction()
        expect(reopened.findBox(untouched.uuid).nonEmpty()).toBe(true)
        expect(reopened.findBox(result.address.uuid).nonEmpty()).toBe(true)
        reopened.beginTransaction()
        updates.toReversed().forEach(update => update.inverse(reopened))
        reopened.endTransaction()
        expect(reopened.toArrayBuffer()).toEqual(before)
        vi.restoreAllMocks()
    })
    it.each([
        [[0, 16], [4, 4]], [[4, 4], [0, 16]], [[0, 16], [0, 4]], [[0, 4], [10, 4]]
    ])("covers the entire supplied union %j", (firstSpan, secondSpan) => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const {boxGraph, create} = fixture(type)
        const first = create(...firstSpan as [number, number]), second = create(...secondSpan as [number, number])
        first.onSelected(); second.onSelected()
        boxGraph.endTransaction()
        boxGraph.beginTransaction()
        const result = first.flatten([first, second]).unwrap()
        boxGraph.endTransaction()
        const start = Math.min(firstSpan[0], secondSpan[0])
        const end = Math.max(firstSpan[0] + firstSpan[1], secondSpan[0] + secondSpan[1])
        expect(result.position.getValue()).toBe(start)
        expect(result.duration.getValue()).toBe(end - start)
        expect(result.loopDuration.getValue()).toBe(end - start)
        const reopened = reopen(boxGraph.toArrayBuffer())
        expect(reopened.findBox<NoteRegionBox | ValueRegionBox>(result.address.uuid).unwrap().duration.getValue()).toBe(end - start)
        vi.restoreAllMocks()
    })
})

it("copies ratchet curves through collection copies and keeps single-note consolidation", () => {
    const {boxGraph, create, context} = fixture("note")
    const region = create(0, 16) as NoteRegionBoxAdapter
    const note = region.optCollection.unwrap().events.asArray()[0]
    note.box.playCount.setValue(4)
    note.box.playCurve.setValue(0.5)
    note.box.duration.setValue(16)
    boxGraph.endTransaction()
    boxGraph.beginTransaction()
    const copiedRegion = region.copyTo({consolidate: true})
    const copy = copiedRegion.optCollection.unwrap().events.asArray()[0]
    expect(copy.playCount).toBe(4)
    expect(copy.playCurve).toBe(0.5)
    const singleNotes = note.consolidate()
    expect(singleNotes.map(event => event.playCount)).toEqual([1, 1, 1, 1])
    boxGraph.endTransaction()
    const reopened = reopen(boxGraph.toArrayBuffer())
    const reopenedNote = reopened.findBox<NoteEventBox>(copy.uuid).unwrap()
    expect(reopenedNote.playCurve.getValue()).toBe(0.5)
    const adapter = context.boxAdapters.adapterFor(copy.box, NoteEventBoxAdapter)
    expect(adapter.computeCurveValue(0.25)).toBe(copy.computeCurveValue(0.25))
})
