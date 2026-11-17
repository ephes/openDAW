import {afterEach, expect, it, vi} from "vitest"
import {Terminable, UUID} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import {AnimationFrame} from "@opendaw/lib-dom"
import {Project, ProjectEnv, TimelineRange} from "@opendaw/studio-core"
import {NoteRegionBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {NoteEventCollectionBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {listenToRegionTrack} from "./RegionTrackListener"
import {RegionReader} from "./RegionReader"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})

const closers: Array<() => void> = []
afterEach(() => closers.splice(0).forEach(close => close()))

const fixture = () => {
    const project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    closers.push(() => project.terminate())
    const {editing, boxGraph, boxAdapters, timelineBoxAdapter} = project
    const createTrack = () => editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), track => {
        track.type.setValue(TrackType.Notes)
        track.tracks.refer(project.primaryAudioUnitBox.tracks); track.target.refer(project.primaryAudioUnitBox)
    })).unwrap()
    const tracks = [createTrack(), createTrack()]
    const addRegion = (track: TrackBox, position: number = PPQN.Bar * 8) => editing.modify(() => {
        const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
        return NoteRegionBox.create(boxGraph, UUID.generate(), region => {
            region.events.refer(collection.owners); region.regions.refer(track.regions)
            region.position.setValue(position); region.duration.setValue(PPQN.Bar); region.loopDuration.setValue(PPQN.Bar)
        })
    }).unwrap()
    const box = addRegion(tracks[0], 0)
    const region = boxAdapters.adapterFor(box, NoteRegionBoxAdapter)
    const moveTo = (track: TrackBox) => editing.modify(() => box.regions.refer(track.regions))
    return {project, editing, timelineBoxAdapter, tracks, box, region, addRegion, moveTo}
}

it("region bound keeps one current-track listener across track moves and retires it", () => {
    const {tracks, region, addRegion, moveTo} = fixture()
    let calls = 0
    const subscription = listenToRegionTrack(region, () => calls++)
    calls = 0
    addRegion(tracks[0])
    const baseline = calls
    expect(baseline).toBeGreaterThan(0)
    for (let index = 1; index <= 8; index++) {moveTo(tracks[index % 2])}
    calls = 0
    addRegion(tracks[0])
    expect(calls).toBe(baseline)
    calls = 0
    addRegion(tracks[1])
    expect(calls).toBe(0)
    moveTo(tracks[1])
    calls = 0
    addRegion(tracks[1])
    expect(calls).toBe(baseline)
    calls = 0
    addRegion(tracks[0])
    expect(calls).toBe(0)
    subscription.terminate()
    subscription.terminate()
    calls = 0
    moveTo(tracks[0])
    addRegion(tracks[0])
    addRegion(tracks[1])
    expect(calls).toBe(0)
})

it("region bound repaints once when its region moves and ignores a detached region", () => {
    const {editing, tracks, box, region, addRegion, moveTo} = fixture()
    let calls = 0
    const subscription = listenToRegionTrack(region, () => calls++)
    calls = 0
    moveTo(tracks[1])
    expect(calls).toBeGreaterThan(0)
    editing.modify(() => box.delete())
    calls = 0
    addRegion(tracks[0])
    addRegion(tracks[1])
    expect(calls).toBe(0)
    subscription.terminate()
})

const frames = () => {
    const callbacks: Array<FrameRequestCallback> = []
    let time = 0
    const owner = {
        requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback),
        cancelAnimationFrame: () => {}
    } as unknown as WindowProxy
    AnimationFrame.start(owner)
    closers.push(() => AnimationFrame.terminate())
    return {flush: () => {for (let index = 0; index < 3; index++) {time += 100; callbacks.splice(0).forEach(callback => callback(time))}}}
}

const range = () => {
    const range = new TimelineRange({padding: 0})
    range.maxUnits = PPQN.Bar * 64
    range.width = 1000
    range.showUnitInterval(0, PPQN.Bar * 4)
    closers.push(() => range.terminate())
    return range
}

it("region reader retires queued range follow-up on disposal", () => {
    const {editing, box, region, timelineBoxAdapter} = fixture()
    const {flush} = frames()
    flush()
    const viewport = range()
    const subscription = RegionReader.forNoteRegionBoxAdapter(region, timelineBoxAdapter).keeoOverlapping(viewport)
    editing.modify(() => box.position.setValue(PPQN.Bar * 32))
    subscription.terminate()
    const before = viewport.unitMin
    flush()
    expect(viewport.unitMin).toBe(before)
    editing.modify(() => box.position.setValue(PPQN.Bar * 40))
    flush()
    expect(viewport.unitMin).toBe(before)
    expect(() => subscription.terminate()).not.toThrow()
})

it("an active region reader coalesces several changes into one follow-up", () => {
    const {editing, box, region, timelineBoxAdapter} = fixture()
    const {flush} = frames()
    flush()
    const viewport = range()
    const subscription = RegionReader.forNoteRegionBoxAdapter(region, timelineBoxAdapter).keeoOverlapping(viewport)
    let moves = 0
    const spy = vi.spyOn(viewport, "moveToUnit").mockImplementation(() => {moves++})
    editing.modify(() => box.position.setValue(PPQN.Bar * 32))
    editing.modify(() => box.loopDuration.setValue(PPQN.Bar * 2))
    editing.modify(() => box.duration.setValue(PPQN.Bar * 2))
    expect(moves).toBe(0)
    flush()
    expect(moves).toBe(1)
    spy.mockRestore()
    subscription.terminate()
})
