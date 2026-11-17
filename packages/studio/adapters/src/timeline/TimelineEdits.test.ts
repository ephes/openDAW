import {describe, expect, it, vi} from "vitest"
import {BoxGraph, Update} from "@opendaw/lib-box"
import {DefaultObservableValue, Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioClipBox, AudioFileBox, AudioPitchStretchBox, AudioRegionBox, AudioUnitBox, CaptureAudioBox, BoxIO, NoteClipBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox,
    ValueClipBox, ValueEventBox, ValueEventCollectionBox, ValueRegionBox, WarpMarkerBox} from "@opendaw/studio-boxes"
import {BoxAdapters} from "../BoxAdapters"
import {BoxAdaptersContext} from "../BoxAdaptersContext"
import {NoteRegionBoxAdapter} from "./region/NoteRegionBoxAdapter"
import {ValueRegionBoxAdapter} from "./region/ValueRegionBoxAdapter"
import {AudioUnitType} from "@opendaw/studio-enums"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {ConstantTempoMap, TimeBase} from "@opendaw/lib-dsp"
import {AudioRegionBoxAdapter} from "./region/AudioRegionBoxAdapter"
import {TrackBoxAdapter} from "./TrackBoxAdapter"
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
    const {boxGraph, create} = fixture("note")
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
})


describe.each(["note", "value"] as const)("%s content trim", type => {
    it.each([false, true])("isolates each translated owner, including two selected mirrors (%s)", trimBoth => {
        const {boxGraph, create, track} = fixture(type)
        const first = create(0, 16)
        const second = first.copyTo({position: 32})
        const content = first.box.events.targetVertex.unwrap()
        const originalEvents = first.optCollection.unwrap().events.asArray()
        const clip = type === "note"
            ? NoteClipBox.create(boxGraph, UUID.generate(), box => {
                box.events.refer(content)
                box.clips.refer(track.clips)
            })
            : ValueClipBox.create(boxGraph, UUID.generate(), box => {
                box.events.refer(content)
                box.clips.refer(track.clips)
            })
        boxGraph.endTransaction()
        const before = boxGraph.toArrayBuffer()
        const updates: Update[] = []
        const subscription = boxGraph.subscribeToAllUpdates({onUpdate: update => updates.push(update)})
        first.onSelected()
        if (trimBoth) {second.onSelected()}
        boxGraph.beginTransaction()
        first.moveContentStart(2)
        if (trimBoth) {second.moveContentStart(2)}
        boxGraph.endTransaction()
        subscription.terminate()
        const positions = (region: typeof first) => region.optCollection.unwrap().events.asArray().map(event => event.position)
        expect(positions(first)).toEqual([-2])
        expect(positions(second)).toEqual(trimBoth ? [-2] : [0])
        expect(clip.events.targetVertex.unwrap()).toBe(content)
        expect(originalEvents.map(event => event.position)).toEqual([0])
        expect(content.box.pointerHub.incoming().length).toBeGreaterThan(0)
        const reopened = reopen(boxGraph.toArrayBuffer())
        expect(reopened.findBox(clip.address.uuid).nonEmpty()).toBe(true)
        const replay = reopen(before)
        replay.beginTransaction()
        updates.forEach(update => update.forward(replay))
        replay.endTransaction()
        expect(replay.toArrayBuffer()).toEqual(reopened.toArrayBuffer())
        replay.beginTransaction()
        updates.toReversed().forEach(update => update.inverse(replay))
        replay.endTransaction()
        expect(replay.toArrayBuffer()).toEqual(before)
    })
})

it("isolates shared warp markers before translating audio content", () => {
    const {boxGraph, context, track} = fixture("value")
    Object.assign(context, {
        tempoMap: new ConstantTempoMap(new DefaultObservableValue(120)),
        sampleManager: {getOrCreate: () => ({subscribe: () => Terminable.Empty})}
    })
    track.type.setValue(TrackType.Audio)
    const file = AudioFileBox.create(boxGraph, UUID.generate())
    const collection = ValueEventCollectionBox.create(boxGraph, UUID.generate())
    const mode = AudioPitchStretchBox.create(boxGraph, UUID.generate())
    const marker = WarpMarkerBox.create(boxGraph, UUID.generate(), box => {
        box.position.setValue(8)
        box.seconds.setValue(0.5)
        box.owner.refer(mode.warpMarkers)
    })
    const createAudio = (position: number) => AudioRegionBox.create(boxGraph, UUID.generate(), box => {
        box.position.setValue(position)
        box.timeBase.setValue(TimeBase.Musical)
        box.duration.setValue(16)
        box.loopDuration.setValue(16)
        box.file.refer(file)
        box.events.refer(collection.owners)
        box.playMode.refer(mode)
        box.regions.refer(track.regions)
    })
    const first = createAudio(0), second = createAudio(32)
    const clip = AudioClipBox.create(boxGraph, UUID.generate(), box => {
        box.clips.refer(track.clips)
        box.events.refer(collection.owners)
        box.file.refer(file)
        box.playMode.refer(mode)
    })
    boxGraph.endTransaction()
    const firstAdapter = context.boxAdapters.adapterFor(first, AudioRegionBoxAdapter)
    const secondAdapter = context.boxAdapters.adapterFor(second, AudioRegionBoxAdapter)
    boxGraph.beginTransaction()
    firstAdapter.moveContentStart(2)
    secondAdapter.moveContentStart(2)
    boxGraph.endTransaction()
    expect(marker.position.getValue()).toBe(8)
    expect(clip.playMode.targetVertex.unwrap()).toBe(mode)
    expect(firstAdapter.optWarpMarkers.unwrap().asArray().map(event => event.position)).toEqual([6])
    expect(secondAdapter.optWarpMarkers.unwrap().asArray().map(event => event.position)).toEqual([6])
    expect(reopen(boxGraph.toArrayBuffer()).findBox<WarpMarkerBox>(marker.address.uuid).unwrap().position.getValue()).toBe(8)
})

it("holds the first eligible automation value in preroll and falls back when all are muted", () => {
    const {boxGraph, context, track, create} = fixture("value")
    Object.assign(context, {clipSequencing: {iterate: () => [{optClip: Option.None, sectionFrom: 0}]}})
    const first = create(10, 4) as ValueRegionBoxAdapter
    const second = create(20, 4) as ValueRegionBoxAdapter
    second.optCollection.unwrap().events.asArray()[0].box.value.setValue(0.25)
    first.box.mute.setValue(true)
    boxGraph.endTransaction()
    const adapter = context.boxAdapters.adapterFor(track, TrackBoxAdapter)
    expect(adapter.valueAt(0, 0.5)).toBe(0.25)
    boxGraph.beginTransaction(); second.box.mute.setValue(true); boxGraph.endTransaction()
    expect(adapter.valueAt(0, 0.5)).toBe(0.5)
    boxGraph.beginTransaction(); first.box.mute.setValue(false); boxGraph.endTransaction()
    expect(adapter.valueAt(0, 0.5)).toBe(0.75)
    expect(adapter.valueAt(18, 0.5)).toBe(0.75)
})
