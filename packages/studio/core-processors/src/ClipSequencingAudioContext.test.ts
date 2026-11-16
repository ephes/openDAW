import {expect, it, vi} from "vitest"
import {Option, SortedSet, UUID} from "@opendaw/lib-std"
import {BoxGraph, Update} from "@opendaw/lib-box"
import {AnyClipBoxAdapter, TrackBoxAdapter} from "@opendaw/studio-adapters"
import {PPQN} from "@opendaw/lib-dsp"
import {ClipSequencingAudioContext} from "./ClipSequencingAudioContext"
import {Block, BlockFlag} from "./processing"

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
    const spy = vi.spyOn(SortedSet.prototype, "forEach").mockImplementation(function (this: SortedSet<unknown, unknown>, callback) {
        return original.call(this, value => {visits++; callback(value)})
    })
    try {remove(UUID.generate())} finally {spy.mockRestore()}
    expect(visits).toBe(1)
})

it.each(["replacement", "stop"])("selecting the playing clip cancels a pending %s", intent => {
    const {context, track, clip} = fixture()
    const a = clip(), b = clip()
    context.schedulePlay(a); Array.from(context.iterate(track.uuid, 0, 1)); context.changes()
    if (intent === "replacement") context.schedulePlay(b)
    else context.scheduleStop(track)
    context.schedulePlay(a)
    const sections = Array.from(context.iterate(track.uuid, 1, PPQN.Bar + 1))
    expect(sections.every(section => section.optClip.contains(a))).toBe(true)
    if (intent === "replacement") {
        expect(context.changes().unwrap()).toEqual({started: [], stopped: [], obsolete: [b.uuid]})
    } else expect(context.changes().isEmpty()).toBe(true)
})

it.each(["play", "stop"])("owns the first crossed %s boundary independent of partition size", intent => {
    const render = (bounds: number[]) => {
        const {context, track, clip} = fixture()
        const a = clip()
        if (intent === "stop") {
            context.schedulePlay(a); Array.from(context.iterate(track.uuid, 0, 0.25)); context.changes()
            context.scheduleStop(track)
        } else context.schedulePlay(a)
        const sections = bounds.slice(1).flatMap((p1, i) => Array.from(context.iterate(track.uuid, bounds[i], p1)))
        return sections.filter(section => intent === "play" ? section.optClip.nonEmpty() : section.optClip.isEmpty())[0].sectionFrom
    }
    expect(render([0.5, PPQN.Bar * 2 + 1])).toBe(PPQN.Bar)
    expect(render([0.5, PPQN.Bar, PPQN.Bar + 1, PPQN.Bar * 2 + 1])).toBe(PPQN.Bar)
})

it("leaves the right endpoint launch to the next half-open span", () => {
    const {context, track, clip} = fixture()
    context.schedulePlay(clip())
    const sections = Array.from(context.iterate(track.uuid, 1, PPQN.Bar))
    expect(sections.every(section => section.optClip.isEmpty())).toBe(true)
    expect(context.changes().isEmpty()).toBe(true)
    Array.from(context.iterate(track.uuid, PPQN.Bar, PPQN.Bar + 1))
    expect(context.changes().unwrap().started).toHaveLength(1)
})

it.each([[0.5, 9], [0.5, 4, 5, 6, 7, 9], [0.5, 4.25, 6.5, 9]])(
    "ends a three-beat one-shot three beats after its four-beat launch (%j)", (...beats) => {
        const {context, track, clip} = fixture()
        const beat = PPQN.Bar / 4, a = clip(3 * beat, false)
        context.schedulePlay(a)
        const sections = beats.slice(1).flatMap((end, i) =>
            Array.from(context.iterate(track.uuid, beats[i] * beat, end * beat)))
        const active = sections.filter(section => section.optClip.nonEmpty())
        expect(active[0].sectionFrom).toBe(4 * beat)
        expect(active.at(-1)!.sectionTo).toBe(7 * beat)
        expect(active.reduce((sum, section) => sum + section.sectionTo - section.sectionFrom, 0)).toBe(3 * beat)
        expect(context.changes().unwrap()).toEqual({started: [a.uuid], stopped: [a.uuid], obsolete: []})
    })

it.each([0, -1, NaN, Infinity, -Infinity])("refuses invalid duration %s and admits a repaired clip", duration => {
    const {context, track, clip} = fixture()
    const a = clip(duration)
    context.schedulePlay(a)
    expect(context.changes().unwrap()).toEqual({started: [], stopped: [], obsolete: [a.uuid]})
    expect(Array.from(context.iterate(track.uuid, 0, PPQN.Bar * 2)).every(s => s.optClip.isEmpty())).toBe(true)
    Object.assign(a, {duration: PPQN.Bar})
    context.schedulePlay(a); Array.from(context.iterate(track.uuid, 0, 1))
    expect(context.changes().unwrap().started).toEqual([a.uuid])
})

it.each([0, -1, NaN, Infinity])("retires mutable invalid duration %s before quantization", duration => {
    const {context, track, clip} = fixture()
    const a = clip(), b = clip()
    context.schedulePlay(a); Array.from(context.iterate(track.uuid, 0, 1)); context.changes()
    context.schedulePlay(b)
    Object.assign(a, {duration}); Object.assign(b, {duration})
    const sections = Array.from(context.iterate(track.uuid, 1, PPQN.Bar * 2))
    expect(sections.every(s => s.optClip.isEmpty() && Number.isFinite(s.sectionFrom) && s.sectionTo > s.sectionFrom)).toBe(true)
    expect(context.changes().unwrap()).toEqual({started: [], stopped: [a.uuid], obsolete: [b.uuid]})
    Object.assign(a, {duration: PPQN.Bar})
    context.schedulePlay(a); Array.from(context.iterate(track.uuid, PPQN.Bar * 2, PPQN.Bar * 2 + 1))
    expect(context.changes().unwrap().started).toEqual([a.uuid])
})

const transportBlock = ([p0, p1]: number[]) =>
    ({index: 0, p0: p0 * PPQN.Bar, p1: p1 * PPQN.Bar, s0: 0, s1: 128, bpm: 120,
        flags: BlockFlag.transporting | BlockFlag.playing} as Block)

// Each quantum reports all of its blocks first, then every block is iterated, as in the engine.
const renderQuanta = (context: ClipSequencingAudioContext, track: TrackBoxAdapter, quanta: number[][][]) =>
    quanta.flatMap(quantum => {
        const blocks = quantum.map(transportBlock)
        context.followTransport(blocks)
        return blocks.flatMap(({p0, p1}) => Array.from(context.iterate(track.uuid, p0, p1)))
    })

it.each([
    ["loop wrap", 2, [[[2.5, 3.5]], [[3.5, 4], [0, 0.5]], [[0.5, 1.5]], [[1.5, 3]]], 1],
    ["loop wrap after a launch in the same quantum", 2, [[[2.5, 2.75]], [[2.75, 4], [0, 0.5]], [[0.5, 3]]], 1],
    ["backward seek", 8, [[[9.5, 12]], [[12, 15]], [[2, 4]], [[4, 8]]], 5],
    ["seek inside a quantum", 8, [[[9.5, 12]], [[12, 15], [2, 3]], [[3, 8]]], 5]
])("keeps a one-shot's elapsed span across a %s", (_label, bars, quanta, endBar) => {
    const {context, track, clip} = fixture()
    const a = clip((bars as number) * PPQN.Bar, false)
    context.schedulePlay(a)
    const active = renderQuanta(context, track, quanta as number[][][]).filter(section => section.optClip.nonEmpty())
    expect(active.reduce((sum, section) => sum + section.sectionTo - section.sectionFrom, 0)).toBe((bars as number) * PPQN.Bar)
    expect(active.at(-1)?.sectionTo).toBe((endBar as number) * PPQN.Bar)
    expect(context.changes().unwrap()).toEqual({started: [a.uuid], stopped: [a.uuid], obsolete: []})
})

it("ends a one-shot independent of interleaved point queries", () => {
    const {context, track, clip} = fixture()
    const a = clip(2 * PPQN.Bar, false), step = 0.25
    context.schedulePlay(a)
    let end = 0
    for (let position = 0; position < 4; position += step) {
        const block = transportBlock([position, position + step])
        context.followTransport([block])
        for (const query of [position + step / 2, position + step / 3]) {
            Array.from(context.iterate(track.uuid, query * PPQN.Bar, query * PPQN.Bar + 1))
        }
        for (const section of context.iterate(track.uuid, block.p0, block.p1)) {
            if (section.optClip.nonEmpty()) {end = section.sectionTo}
        }
    }
    expect(end).toBe(2 * PPQN.Bar)
})
