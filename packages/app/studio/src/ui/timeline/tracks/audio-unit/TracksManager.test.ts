import {expect, it, vi} from "vitest"
import {Listeners, UUID} from "@opendaw/lib-std"
import type {AudioUnitBoxAdapter, TrackBoxAdapter} from "@opendaw/studio-adapters"
import type {IndexedAdapterCollectionListener, IndexedBoxAdapter} from "@opendaw/studio-adapters"
import type {StudioService} from "@/service/StudioService"
import {TracksManager} from "./TracksManager"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
vi.mock("./AudioUnitTracks.tsx", () => ({AudioUnitTracks: () => document.createElement("div")}))

const collection = <A extends IndexedBoxAdapter>(entries: A[]) => {
    const listeners = new Listeners<IndexedAdapterCollectionListener<A>>()
    return {
        catchupAndSubscribe(listener: IndexedAdapterCollectionListener<A>) {
            entries.forEach(entry => listener.onAdd(entry))
            return listeners.subscribe(listener)
        },
        add(entry: A) {entries.push(entry); listeners.proxy.onAdd(entry)},
        remove(entry: A) {entries.splice(entries.indexOf(entry), 1); listeners.proxy.onRemove(entry)},
        reorder(entry: A) {listeners.proxy.onReorder(entry)},
        get listenerCount() {return listeners.size}
    }
}

const fixture = (numUnits: number, tracksPerUnit = 1) => {
    const work = {writes: 0, reads: 0}
    const indexField = (initial: number) => {
        let value = initial
        return {getValue: () => {work.reads++; return value}, setValue: (next: number) => {value = next}}
    }
    const makeTrack = (order: number) => {
        let listIndex = -1
        const index = indexField(order)
        const adapter = {uuid: UUID.generate(), indexField: index,
            get listIndex() {return listIndex},
            set listIndex(value: number) {work.writes++; listIndex = value}
        } as unknown as TrackBoxAdapter
        return {adapter, index}
    }
    const makeUnit = (order: number, numTracks = tracksPerUnit) => {
        const tracks = Array.from({length: numTracks}, (_, index) => makeTrack(numTracks - index - 1))
        const trackCollection = collection(tracks.map(track => track.adapter))
        const index = indexField(order)
        const adapter = {uuid: UUID.generate(), indexField: index, tracks: trackCollection} as unknown as AudioUnitBoxAdapter
        return {adapter, tracks, index, trackCollection}
    }
    const units = Array.from({length: numUnits}, (_, index) => makeUnit(numUnits - index - 1))
    const audioUnits = collection(units.map(unit => unit.adapter))
    const container = document.createElement("div")
    const service = {project: {rootBoxAdapter: {audioUnits}}} as unknown as StudioService
    const manager = new TracksManager(service, container, {create: () => document.createElement("div")})
    return {manager, container, units, audioUnits, makeUnit, makeTrack, work}
}

const expectOrder = (manager: TracksManager, expected: TrackBoxAdapter[]) => {
    expect(manager.tracks().map(track => track.trackBoxAdapter)).toEqual(expected)
    expected.forEach((track, index) => expect(track.listIndex).toBe(index))
}

it.each([100, 200, 400])("orders %s initial units once before construction returns", count => {
    const {manager, units, work} = fixture(count)
    expect(work.writes).toBe(count)
    expect(work.reads).toBeLessThan(count * Math.ceil(Math.log2(count)) * 4)
    expectOrder(manager, units.toReversed().flatMap(unit => unit.tracks.map(track => track.adapter)))
    manager.terminate()
})

it("orders multi-track units and immediately handles live inserts, reorders and removals", () => {
    const {manager, units, audioUnits, makeUnit, makeTrack, work, container} = fixture(2, 3)
    const ordered = () => units.toSorted((first, second) => first.index.getValue() - second.index.getValue())
        .flatMap(unit => unit.tracks.toSorted((first, second) => first.index.getValue() - second.index.getValue())
            .map(track => track.adapter))
    expect(work.writes).toBe(6)
    expectOrder(manager, ordered())
    const inserted = makeTrack(4)
    units[0].tracks.push(inserted)
    units[0].trackCollection.add(inserted.adapter)
    expectOrder(manager, ordered())
    inserted.index.setValue(-1)
    units[0].trackCollection.reorder(inserted.adapter)
    expectOrder(manager, ordered())
    units[0].index.setValue(-1)
    audioUnits.reorder(units[0].adapter)
    expectOrder(manager, ordered())
    units[0].trackCollection.remove(inserted.adapter)
    units[0].tracks.splice(units[0].tracks.indexOf(inserted), 1)
    expectOrder(manager, ordered())
    const added = makeUnit(3, 2)
    units.push(added)
    audioUnits.add(added.adapter)
    expectOrder(manager, ordered())
    audioUnits.remove(units[1].adapter)
    units.splice(1, 1)
    expectOrder(manager, ordered())
    manager.terminate()
    expect(container.children).toHaveLength(0)
    expect(audioUnits.listenerCount).toBe(0)
    units.forEach(unit => expect(unit.trackCollection.listenerCount).toBe(0))
})

it("handles empty initial collections and the first live unit synchronously", () => {
    const {manager, audioUnits, makeUnit, work} = fixture(0)
    expectOrder(manager, [])
    expect(work.writes).toBe(0)
    const empty = makeUnit(0, 0)
    audioUnits.add(empty.adapter)
    expectOrder(manager, [])
    const added = makeUnit(1, 2)
    audioUnits.add(added.adapter)
    expectOrder(manager, added.tracks.toReversed().map(track => track.adapter))
    audioUnits.remove(added.adapter)
    expectOrder(manager, [])
    manager.terminate()
})
