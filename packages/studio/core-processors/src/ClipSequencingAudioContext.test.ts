import {expect, it, vi} from "vitest"
import {Option, SortedSet, UUID} from "@opendaw/lib-std"
import {BoxGraph, Update} from "@opendaw/lib-box"
import {AnyClipBoxAdapter, TrackBoxAdapter} from "@opendaw/studio-adapters"
import {PPQN} from "@opendaw/lib-dsp"
import {ClipSequencingAudioContext} from "./ClipSequencingAudioContext"

function fixture() {
    const observers = new Set<{onUpdate: (update: Update) => void}>()
    const release = vi.fn()
    const graph = {subscribeToAllUpdatesImmediate: (observer: {onUpdate: (update: Update) => void}) => {
        observers.add(observer)
        return {terminate: () => {release(); observers.delete(observer)}}
    }} as unknown as BoxGraph
    const context = new ClipSequencingAudioContext(graph)
    const track = {uuid: UUID.generate()} as TrackBoxAdapter
    const clip = (duration = PPQN.Bar, loop = true) => ({uuid: UUID.generate(), duration,
        trackBoxAdapter: Option.wrap(track), box: {triggerMode: {loop: {getValue: () => loop}}}
    } as unknown as AnyClipBoxAdapter)
    const remove = (uuid: UUID.Bytes) => observers.forEach(observer => observer.onUpdate({type: "delete", uuid} as Update))
    return {context, track, clip, remove, observers, release}
}

it("releases graph observation once and leaves only live contexts observing", () => {
    const {context, observers, release} = fixture()
    context.terminate(); context.terminate()
    expect(release).toHaveBeenCalledOnce()
    expect(observers.size).toBe(0)
})

it("retires deleted track state and notifies playing and pending clip owners", () => {
    const {context, track, clip, remove} = fixture()
    const playing = clip(), waiting = clip()
    context.schedulePlay(playing); Array.from(context.iterate(track.uuid, 0, 1)); context.changes()
    context.schedulePlay(waiting)
    remove(track.uuid)
    expect(context.changes().unwrap()).toEqual({started: [], stopped: [playing.uuid], obsolete: [waiting.uuid]})
})

it("retains and visits only live tracks after deletion churn", () => {
    const {context, track, remove} = fixture()
    for (let i = 0; i < 2000; i++) {
        const track = {uuid: UUID.generate()} as TrackBoxAdapter
        context.scheduleStop(track); remove(track.uuid)
    }
    context.scheduleStop(track) // one live track
    let visits = 0
    const original = SortedSet.prototype.forEach
    const spy = vi.spyOn(SortedSet.prototype, "forEach").mockImplementation(function (callback) {
        return original.call(this, value => {visits++; callback(value)})
    })
    try {remove(UUID.generate())} finally {spy.mockRestore()}
    expect(visits).toBe(1)
})
