import {afterEach, describe, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NoteEventCollectionBox, NoteRegionBox, TrackBox, ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {AnyRegionBoxAdapter, BoxAdapters, BoxAdaptersContext, NoteRegionBoxAdapter, ProjectSkeleton, TrackBoxAdapter, TrackType, ValueRegionBoxAdapter} from "@opendaw/studio-adapters"
import {ProjectApi} from "../../project"
import {RegionKeepExistingResolver} from "./RegionKeepExistingResolver"
import {RegionPushExistingResolver} from "./RegionPushExistingResolver"
import {RegionModifyStrategies, RegionModifyStrategy} from "./RegionModifyStrategies"

const fixture = (type = TrackType.Value) => {
    const skeleton = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const graph = skeleton.boxGraph
    graph.beginTransaction()
    const unit = AudioUnitBox.create(graph, UUID.generate(), box => box.collection.refer(skeleton.mandatoryBoxes.rootBox.audioUnits))
    const makeTrack = (type: TrackType, index = 0) => TrackBox.create(graph, UUID.generate(), box => {
        box.tracks.refer(unit.tracks)
        box.target.refer(type === TrackType.Value ? unit.volume : unit)
        box.type.setValue(type)
        box.index.setValue(index)
    })
    const trackBox = makeTrack(type)
    const makeRegion = (position: number) => {
        if (type === TrackType.Value) {
            const events = ValueEventCollectionBox.create(graph, UUID.generate())
            return ValueRegionBox.create(graph, UUID.generate(), box => {
                box.regions.refer(trackBox.regions); box.events.refer(events.owners)
                box.position.setValue(position); box.duration.setValue(10); box.loopDuration.setValue(10)
            })
        }
        const events = NoteEventCollectionBox.create(graph, UUID.generate())
        return NoteRegionBox.create(graph, UUID.generate(), box => {
            box.regions.refer(trackBox.regions); box.events.refer(events.owners)
            box.position.setValue(position); box.duration.setValue(10); box.loopDuration.setValue(10)
        })
    }
    const incomingBox = makeRegion(0)
    const existingBox = makeRegion(20)
    graph.endTransaction()
    const context = {boxGraph: graph} as BoxAdaptersContext
    const adapters = new BoxAdapters(context)
    Object.assign(context, {boxAdapters: adapters})
    const track = adapters.adapterFor(trackBox, TrackBoxAdapter)
    track.listIndex = 0
    const incoming = incomingBox instanceof ValueRegionBox
        ? adapters.adapterFor(incomingBox, ValueRegionBoxAdapter) : adapters.adapterFor(incomingBox, NoteRegionBoxAdapter)
    incoming.onSelected()
    const api = {
        createNoteTrack: vi.fn((_unit: AudioUnitBox, index: number) => makeTrack(TrackType.Notes, index)),
        createAudioTrack: vi.fn((_unit: AudioUnitBox, index: number) => makeTrack(TrackType.Audio, index))
    }
    return {graph, editing: new BoxEditing(graph), adapters, track, incoming, existingBox, api, projectApi: api as unknown as ProjectApi}
}
const strategy = (copy: boolean): RegionModifyStrategies => ({
    ...RegionModifyStrategies.Identity,
    showOrigin: () => copy,
    selectedModifyStrategy: () => ({...RegionModifyStrategy.Identity, readPosition: () => 20, readComplete: () => 30})
})
afterEach(() => vi.restoreAllMocks())

describe("keep-existing automation ownership", () => {
    it.each([false, true])("keeps overlapping automation on its value track (copy=%s), with exact undo", copy => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const f = fixture()
        const before = f.graph.checksum()
        const json = f.graph.toJSON()
        const {postProcess, trackResolver} = RegionKeepExistingResolver.fromSelection(
            [f.track], [f.incoming], strategy(copy), 0, f.projectApi, f.adapters)
        f.editing.modify(() => {
            if (copy) {f.incoming.copyTo({target: trackResolver(f.incoming, f.track).box.regions, position: 20})}
            else {f.incoming.position = 20}
            postProcess()
        })
        expect(f.api.createNoteTrack).not.toHaveBeenCalled()
        expect(f.api.createAudioTrack).not.toHaveBeenCalled()
        expect(f.incoming.trackBoxAdapter.unwrap()).toBe(f.track)
        expect(f.track.box.regions.pointerHub.incoming()).toHaveLength(copy ? 3 : 2)
        f.graph.verifyPointers()
        expect(f.editing.undo()).toBe(true)
        expect(f.graph.checksum()).toEqual(before)
        expect(f.graph.toJSON()).toEqual(json)
        f.adapters.terminate()
    })
})

describe("push-existing inventory", () => {
    it("deduplicates overlapping selected ranges without array identity scans, retaining first-visit order", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const f = fixture(TrackType.Notes)
        const before = f.graph.checksum()
        const existing = f.adapters.adapterFor(f.existingBox, NoteRegionBoxAdapter)
        const includes = Array.prototype.includes
        let scans = 0
        vi.spyOn(Array.prototype, "includes").mockImplementation(function(this: unknown[], value: unknown, from?: number) {
            if (value === existing) {scans += this.length}
            return includes.call(this, value, from)
        })
        const {postProcess} = RegionPushExistingResolver.fromSelection(
            [f.track], [f.incoming, f.incoming, f.incoming], strategy(false), 0, f.projectApi, f.adapters)
        // Region inventory should use identity membership, not scan a growing array.
        expect(scans).toBe(0)
        f.editing.modify(() => {f.incoming.position = 20; postProcess()})
        expect(f.api.createNoteTrack).toHaveBeenCalledTimes(1)
        expect(existing.trackBoxAdapter.unwrap().box).toBe(f.api.createNoteTrack.mock.results[0].value)
        expect(f.editing.undo()).toBe(true)
        expect(f.graph.checksum()).toEqual(before)
        f.adapters.terminate()
    })

    it("moves a dense synthetic inventory in stable order without exceeding the argument limit", () => {
        const count = 150_000
        const moved: number[] = []
        const destination = {regions: {}}
        const regions = Array.from({length: count}, (_, i) => ({
            position: i, complete: i + 1,
            box: {regions: {refer: (target: unknown) => {expect(target).toBe(destination.regions); moved.push(i)}}}
        })) as unknown as AnyRegionBoxAdapter[]
        const track = {
            type: TrackType.Notes, indexField: {getValue: () => 0},
            audioUnit: {tracks: {pointerHub: {incoming: () => []}}},
            regions: {collection: {iterateRange: () => regions}, dispatchChange: vi.fn()}
        } as unknown as TrackBoxAdapter
        const createNoteTrack = vi.fn(() => destination)
        const adapter = {box: destination, regions: {dispatchChange: vi.fn()}}
        const post = RegionPushExistingResolver.fromRange(track, 0, count,
            {createNoteTrack} as unknown as ProjectApi,
            {adapterFor: () => adapter} as unknown as BoxAdapters)
        expect(() => post()).not.toThrow()
        expect(createNoteTrack).toHaveBeenCalledTimes(1)
        expect(moved).toEqual(Array.from({length: count}, (_, i) => i))
    })
})
