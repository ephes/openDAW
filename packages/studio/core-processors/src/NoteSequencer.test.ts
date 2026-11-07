import {describe, expect, it} from "vitest"
import {EventCollection, NoteEvent} from "@opendaw/lib-dsp"
import {Option, UUID} from "@opendaw/lib-std"
import {AudioUnitBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {EngineContext} from "./EngineContext"
import {NoteSequencer} from "./NoteSequencer"
import {NoteLifecycleEvent} from "./NoteEventSource"
import {BlockFlag} from "./processing"

const flags = BlockFlag.transporting | BlockFlag.playing
const note = (overrides = {}) => ({type: "note-event" as const, position: 0, duration: 10, pitch: 60,
    velocity: 1, cent: 0, chance: 100, playCount: 1, playCurve: 0, ...overrides})
function fixture(duration = 4, truncate = true, notes = [note()]) {
    const events = EventCollection.create<NoteEvent>()
    notes.forEach(n => events.add(n))
    const clip = {duration, optCollection: Option.wrap({events, maxDuration: 10})}
    const context = {
        subscribeProcessPhase: () => ({terminate() {}}),
        preferences: {settings: {playback: {truncateNotesAtRegionEnd: truncate}}},
        clipSequencing: {iterate: (_id: unknown, from: number, to: number) =>
            [{optClip: Option.wrap(clip), sectionFrom: from, sectionTo: to}]}
    } as unknown as EngineContext
    const adapter = {uuid: UUID.generate(), tracks: {collection: {adapters: () =>
        [{uuid: UUID.generate(), type: TrackType.Notes, enabled: {getValue: () => true}}]}}} as unknown as AudioUnitBoxAdapter
    return new NoteSequencer(context, adapter)
}
const starts = (s: NoteSequencer, a: number, b: number) => Array.from(s.processNotes(a, b, flags)).filter(NoteLifecycleEvent.isStart)
describe("NoteSequencer live and clip boundaries", () => {
    it("isolates unstarted and running releases by pitch", () => {
        const s = fixture()
        s.pushRawNoteOn(60, 1); s.pushRawNoteOn(64, 1); s.pushRawNoteOff(61)
        expect(Array.from(s.iterateActiveNotesAt(0, true)).map(n => n.pitch)).toEqual([60, 64])
        s.pushRawNoteOff(60)
        const running = Array.from(s.processNotes(0, 1, 0))
        expect(running.map(n => n.pitch)).toEqual([64])
        s.pushRawNoteOff(64)
        expect(Array.from(s.processNotes(1, 2, 0))).toEqual([NoteLifecycleEvent.stop(running[0] as ReturnType<typeof NoteLifecycleEvent.start>, 1)])
        expect(Array.from(s.processNotes(2, 3, 0))).toEqual([])
    })
    it.each([0, -0.5, 0.5])("caps every curved repeat at the clip end (%s)", playCurve => {
        const s = fixture(4, true, [note({playCount: 2, playCurve})])
        const events = Array.from(s.processNotes(0, 4, flags))
        const on = events.filter(NoteLifecycleEvent.isStart)
        expect(on.length).toBeGreaterThan(0)
        on.forEach(n => {expect(n.duration).toBeGreaterThan(0); expect(n.position + n.duration).toBeLessThanOrEqual(4)})
        expect([...events, ...s.processNotes(4, 4.1, 0)].filter(NoteLifecycleEvent.isStop).map(n => n.id)).toEqual(on.map(n => n.id))
        const tails = starts(fixture(4, false, [note({playCount: 2, playCurve})]), 0, 4)
        expect(tails.some(n => n.position + n.duration > 4)).toBe(true)
    })
    it("queries every cycle once with half-open endpoints", () => {
        expect(starts(fixture(1), 0, 3).map(n => n.position)).toEqual([0, 1, 2])
        const whole = starts(fixture(1), 0.25, 4).map(n => [n.position, n.duration])
        const s = fixture(1)
        const split = [[0.25, 1], [1, 2.5], [2.5, 4]].flatMap(([a, b]) => starts(s, a, b).map(n => [n.position, n.duration]))
        expect(split).toEqual(whole)
        expect(whole.map(n => n[0])).toEqual([1, 2, 3])
    })
})
