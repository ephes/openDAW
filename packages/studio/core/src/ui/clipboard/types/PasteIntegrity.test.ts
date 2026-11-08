import {afterEach, describe, expect, it, vi} from "vitest"
import {ByteArrayInput, ByteArrayOutput, Option, Selection, UUID} from "@opendaw/lib-std"
import {BoxEditing, BoxGraph} from "@opendaw/lib-box"
import {AudioUnitBox, BoxIO, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox, ValueEventBox, ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {BoxAdapters, NoteEventBoxAdapter, ProjectSkeleton, TrackBoxAdapter, TrackType, ValueEventBoxAdapter, ValueEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {ClipboardUtils} from "../ClipboardUtils"
import {NotesClipboard} from "./NotesClipboardHandler"
import {ValuesClipboard} from "./ValuesClipboardHandler"
import {RegionsClipboard} from "./RegionsClipboardHandler"
import {RegionOverlapResolver} from "../../timeline/RegionOverlapResolver"

afterEach(() => vi.restoreAllMocks())

const metadata = (min: number, max: number) => {
    const output = ByteArrayOutput.create()
    output.writeFloat(min)
    output.writeFloat(max)
    return output.toArrayBuffer()
}

const setup = (kind: "notes" | "values") => {
    const {boxGraph: graph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    const collection = editing.modify(() => {
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => {
            box.type.setValue(AudioUnitType.Instrument)
            box.collection.refer(rootBox.audioUnits)
            box.output.refer(primaryAudioBusBox.input)
        })
        const track = TrackBox.create(graph, UUID.generate(), box => {
            box.tracks.refer(unit.tracks)
            box.target.refer(unit)
            box.type.setValue(TrackType.Notes)
        })
        const collection = kind === "notes"
            ? NoteEventCollectionBox.create(graph, UUID.generate())
            : ValueEventCollectionBox.create(graph, UUID.generate())
        const region = kind === "notes" ? NoteRegionBox.create(graph, UUID.generate()) : ValueRegionBox.create(graph, UUID.generate())
        region.regions.refer(track.regions)
        region.events.refer(collection.owners)
        return collection
    }).unwrap()
    const create = (position: number) => editing.modify(() => {
        const box = kind === "notes" ? NoteEventBox.create(graph, UUID.generate()) : ValueEventBox.create(graph, UUID.generate())
        box.events.refer(collection.events)
        box.position.setValue(position)
        return box
    }).unwrap()
    const original = create(15)
    const incoming = create(0)
    const data = ClipboardUtils.serializeBoxes([incoming], metadata(0, 20))
    editing.modify(() => incoming.delete())
    const adapter = {box: original, position: 15, index: 0} as NoteEventBoxAdapter & ValueEventBoxAdapter
    let selected = [adapter]
    const selection = {
        selected: () => selected.slice(), nonEmpty: () => selected.length > 0,
        deselectAll: vi.fn(() => {selected = []}),
        select: vi.fn((...items: typeof selected) => {selected.push(...items)})
    } as unknown as Selection<NoteEventBoxAdapter> & Selection<ValueEventBoxAdapter>
    let position = 10
    const setPosition = vi.fn((value: number) => {position = value})
    const context = {
        getEnabled: () => true, getPosition: () => position, setPosition, editing, selection,
        targetAddress: collection.events.address, boxGraph: graph,
        boxAdapters: {adapterFor: (box: NoteEventBox | ValueEventBox) => ({box, position: box.position.getValue(), index: 0})} as unknown as BoxAdapters
    }
    const handler = kind === "notes" ? NotesClipboard.createHandler(context) : ValuesClipboard.createHandler({
        ...context, collection: {events: {asArray: () => [adapter]}} as unknown as ValueEventCollectionBoxAdapter
    })
    return {handler, graph, selection, adapter, incoming, data, setPosition, getPosition: () => position}
}

describe.each(["notes", "values"] as const)("%s paste integrity", kind => {
    it.each(["corrupt graph", "creation failure"])("preserves graph, selected adapters and cursor after %s", fault => {
        const {handler, graph, selection, adapter, data, setPosition, getPosition} = setup(kind)
        const before = new Uint8Array(graph.toArrayBuffer())
        const realCreate = graph.createBox.bind(graph)
        const create = vi.spyOn(graph, "createBox")
        if (fault === "creation failure") {
            create.mockImplementation((...args) => {
                realCreate(...args)
                throw new Error("synthetic installation failure")
            })
        }
        const broken = data.slice(0, data.byteLength - 1)
        expect(() => handler.paste({type: kind, data: fault === "corrupt graph" ? broken : data})).toThrow()
        if (fault === "creation failure") {expect(create).toHaveBeenCalledOnce()}
        expect(new Uint8Array(graph.toArrayBuffer())).toEqual(before)
        expect(selection.selected()).toEqual([adapter])
        expect(selection.selected()[0]).toBe(adapter)
        expect(getPosition()).toBe(10)
        expect(setPosition).not.toHaveBeenCalled()
    })

    it.each([[NaN, 20], [0, Infinity], [-Infinity, 20], [20, 0]])("refuses invalid time span %s..%s before editing", (min, max) => {
        const {handler, graph, selection, adapter, data: valid, setPosition} = setup(kind)
        const data = valid.slice(0)
        new Uint8Array(data).set(new Uint8Array(metadata(min, max)), 4)
        const before = new Uint8Array(graph.toArrayBuffer())
        const create = vi.spyOn(graph, "createBox")
        expect(() => handler.paste({type: kind, data})).toThrow("Invalid clipboard time span")
        expect(create).not.toHaveBeenCalled()
        expect(new Uint8Array(graph.toArrayBuffer())).toEqual(before)
        expect(selection.selected()).toEqual([adapter])
        expect(setPosition).not.toHaveBeenCalled()
    })

    it("selects the pasted events and advances the cursor on success", () => {
        const {handler, selection, adapter, data, getPosition} = setup(kind)
        handler.paste({type: kind, data})
        expect(selection.selected()).toHaveLength(1)
        expect(selection.selected()[0]).not.toBe(adapter)
        expect(selection.selected()[0].position).toBe(10)
        expect(getPosition()).toBe(30)
    })
})

describe("region placement admission", () => {
    const first = UUID.generate()
    const second = UUID.generate()
    const trackMetadata = (min: number, max: number, tracks: {uuid: UUID.Bytes, offset: number, type: number}[]) => {
        const output = ByteArrayOutput.create()
        output.writeBytes(new Int8Array(metadata(min, max)))
        output.writeInt(tracks.length)
        tracks.forEach(({uuid, offset, type}) => {
            output.writeBytes(new Int8Array(uuid))
            output.writeInt(offset)
            output.writeInt(type)
        })
        return output.toArrayBuffer()
    }
    it.each([
        [NaN, 20, [{uuid: first, offset: 0, type: TrackType.Notes}]],
        [20, 0, [{uuid: first, offset: 0, type: TrackType.Notes}]],
        [0, Infinity, [{uuid: first, offset: 0, type: TrackType.Notes}]],
        [0, 20, [{uuid: first, offset: -1, type: TrackType.Notes}]],
        [0, 20, [{uuid: first, offset: 0, type: 999}]],
        [0, 20, [{uuid: first, offset: 0, type: TrackType.Notes}, {uuid: first, offset: 1, type: TrackType.Notes}]],
        [0, 20, [{uuid: first, offset: 0, type: TrackType.Notes}, {uuid: second, offset: 0, type: TrackType.Notes}]]
    ] as const)("rejects malformed region metadata %# before editing", (min, max, tracks) => {
        const graph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
        const editing = new BoxEditing(graph)
        const modify = vi.spyOn(editing, "modify")
        const setPosition = vi.fn()
        const track = {type: TrackType.Notes} as TrackBoxAdapter
        const handler = RegionsClipboard.createHandler({
            getEnabled: () => true, getPosition: () => 10, setPosition, editing,
            selection: {deselectAll: vi.fn()} as unknown as RegionsClipboard.Context["selection"],
            boxGraph: graph, boxAdapters: {} as BoxAdapters, getTracks: () => [track, track],
            getFocusedTrack: () => Option.wrap(track), overlapResolver: {} as RegionOverlapResolver
        })
        const data = ClipboardUtils.serializeBoxes([], trackMetadata(min, max, [...tracks]))
        expect(() => handler.paste({type: "regions", data})).toThrow()
        expect(modify).not.toHaveBeenCalled()
        expect(setPosition).not.toHaveBeenCalled()
    })
    it("preserves valid multi-track spacing when mapping regions", () => {
        const {graph} = setup("notes")
        const editing = new BoxEditing(graph)
        const sourceTrack = graph.boxes().find((box): box is TrackBox => box instanceof TrackBox)!
        const sourceRegion = graph.boxes().find((box): box is NoteRegionBox => box instanceof NoteRegionBox)!
        const sourceCollection = graph.boxes().find((box): box is NoteEventCollectionBox => box instanceof NoteEventCollectionBox)!
        const otherTrack = editing.modify(() => TrackBox.create(graph, UUID.generate(), box => {
            box.read(new ByteArrayInput(sourceTrack.toArrayBuffer()))
        })).unwrap()
        const otherCollection = editing.modify(() => {
            const collection = NoteEventCollectionBox.create(graph, UUID.generate())
            NoteRegionBox.create(graph, UUID.generate(), box => {
                box.regions.refer(otherTrack.regions)
                box.events.refer(collection.owners)
                box.position.setValue(5)
            })
            return collection
        }).unwrap()
        const otherRegion = graph.boxes().find((box): box is NoteRegionBox =>
            box instanceof NoteRegionBox && box.regions.targetAddress.unwrap().equals(otherTrack.regions.address))!
        const tracks = [sourceTrack, sourceTrack, otherTrack].map(box => ({box, uuid: box.address.uuid, type: TrackType.Notes}) as TrackBoxAdapter)
        const fromRange = vi.fn<RegionOverlapResolver["fromRange"]>(() => () => {})
        const setPosition = vi.fn()
        const handler = RegionsClipboard.createHandler({
            getEnabled: () => true, getPosition: () => 100, setPosition, editing,
            selection: {deselectAll: vi.fn(), select: vi.fn()} as unknown as RegionsClipboard.Context["selection"],
            boxGraph: graph, boxAdapters: {adapterFor: (box: NoteRegionBox) => ({box})} as unknown as BoxAdapters,
            getTracks: () => tracks, getFocusedTrack: () => Option.wrap(tracks[0]),
            overlapResolver: {fromRange} as unknown as RegionOverlapResolver
        })
        const data = ClipboardUtils.serializeBoxes([sourceRegion, otherRegion, sourceCollection, otherCollection], trackMetadata(0, 20, [
            {uuid: sourceTrack.address.uuid, offset: 0, type: TrackType.Notes},
            {uuid: otherTrack.address.uuid, offset: 2, type: TrackType.Notes}
        ]))
        handler.paste({type: "regions", data})
        expect(fromRange).toHaveBeenCalledTimes(2)
        expect(fromRange.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([tracks[0], tracks[2]]))
        const pasted = graph.boxes().filter((box): box is NoteRegionBox =>
            box instanceof NoteRegionBox && box !== sourceRegion && box !== otherRegion)
        expect(pasted.map(box => box.position.getValue()).sort((a, b) => a - b)).toEqual([100, 105])
        expect(pasted.map(box => box.regions.targetAddress.unwrap().toString()).sort()).toEqual(
            [sourceTrack.regions.address.toString(), otherTrack.regions.address.toString()].sort())
        expect(setPosition).toHaveBeenCalledWith(120)
    })

})
