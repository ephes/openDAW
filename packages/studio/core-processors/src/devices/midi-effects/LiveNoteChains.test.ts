import {expect, it} from "vitest"
import {NoteEvent} from "@opendaw/lib-dsp"
import {AudioUnitBoxAdapter, GrooveAdapter} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {NoteEventSource, NoteLifecycleEvent} from "../../NoteEventSource"
import {NoteSequencer} from "../../NoteSequencer"
import {EngineContext} from "../../EngineContext"
import {BlockFlag} from "../../processing"
import {noteChainFixture} from "./note-chain-fixture"

function source(note: NoteEvent): NoteEventSource {
    const start = NoteLifecycleEvent.startWith(note)
    return {
        *processNotes(from, to) {
            for (const e of [start, NoteLifecycleEvent.stop(start, start.position + start.duration)]) {
                if (from <= e.position && e.position < to) {yield {...e}}
            }
        },
        *iterateActiveNotesAt(position) {
            if (note.position <= position && position < note.position + note.duration) {yield {...note}}
        }
    }
}
const note = (position = 120, duration = 300): NoteEvent =>
    ({type: "note-event", position, duration, pitch: 60, velocity: 0.8, cent: 0})

it.each(["replace", "terminate"])("keeps a shared groove subscribed after %s", action => {
    const f = noteChainFixture(), first = f.zeitgeist(), second = f.zeitgeist()
    second.processor.setNoteEventSource(source(note()))
    const before = [...second.processor.processNotes(0, 1000, 0)][0].position
    if (action === "replace") {f.edit(() => first.box.groove.defer())} else {first.processor.terminate()}
    f.edit(() => f.groove.amount.setValue(0.2))
    const groove = f.adapters.adapterFor(f.groove, GrooveAdapter.checkType)
    const after = [...second.processor.processNotes(0, 1000, 0)][0].position
    expect(after).not.toBe(before)
    expect(after).toBe(groove.warp(120))
})

it("projects both active-note endpoints across adjacent windows and into an arpeggio", () => {
    const f = noteChainFixture(), z = f.zeitgeist().processor
    const n = note(), groove = f.adapters.adapterFor(f.groove, GrooveAdapter.checkType)
    z.setNoteEventSource(source(n))
    const active = [...z.iterateActiveNotesAt(groove.warp(240), false)][0]
    const events = [...z.processNotes(0, groove.warp(240), 0), ...z.processNotes(groove.warp(240), 1000, 0)]
    expect(active.position).toBe(events[0].position)
    expect(active.position + active.duration).toBeCloseTo(events[1].position)
    const arp = f.arpeggio(box => box.rateIndex.setValue(12))
    arp.setNoteEventSource(z)
    expect([...arp.processNotes(0, 1000, BlockFlag.transporting)].filter(NoteLifecycleEvent.isStart).length).toBeGreaterThan(0)
    const identity = f.zeitgeist()
    f.edit(() => identity.box.groove.defer())
    identity.processor.setNoteEventSource(source(n))
    expect([...identity.processor.iterateActiveNotesAt(240, true)]).toEqual([n])
    const held = f.zeitgeist().processor
    held.setNoteEventSource(source(note(120, Infinity)))
    expect([...held.iterateActiveNotesAt(groove.warp(240), true)][0].duration).toBe(Infinity)
})

it("leaves retained upstream active notes unchanged across repeated queries", () => {
    const f = noteChainFixture(), z = f.zeitgeist().processor
    const retained = note(), groove = f.adapters.adapterFor(f.groove, GrooveAdapter.checkType)
    z.setNoteEventSource({
        *processNotes() {},
        *iterateActiveNotesAt() {yield retained}
    })
    const first = [...z.iterateActiveNotesAt(groove.warp(240), false)][0]
    const second = [...z.iterateActiveNotesAt(groove.warp(240), false)][0]
    expect(retained).toEqual(note())
    expect(second).toEqual(first)
    expect(first.position).toBe(groove.warp(120))
    expect(first.position + first.duration).toBeCloseTo(groove.warp(420))
})

it("leaves retained upstream active notes unchanged through pitch and velocity", () => {
    const f = noteChainFixture(), retained = note()
    const retaining: NoteEventSource = {*processNotes() {}, *iterateActiveNotesAt() {yield retained}}
    const pitch = f.pitch(box => {box.semiTones.setValue(2); box.cents.setValue(10)})
    const velocity = f.velocity(box => {box.offset.setValue(0.1); box.mix.setValue(1.0)})
    pitch.setNoteEventSource(retaining); velocity.setNoteEventSource(retaining)
    const pitched = [...pitch.iterateActiveNotesAt(200, false), ...pitch.iterateActiveNotesAt(200, false)]
    const voiced = [...velocity.iterateActiveNotesAt(200, false), ...velocity.iterateActiveNotesAt(200, false)]
    expect(retained).toEqual(note())
    expect(pitched.map(event => [event.pitch, event.cent])).toEqual([[62, 10], [62, 10]])
    expect(voiced[1].velocity).toBe(voiced[0].velocity)
    expect(voiced[0].velocity).toBeCloseTo(0.9)
})

it("feeds held keyboard input through two arpeggios while stopped and excludes timeline notes", () => {
    const f = noteChainFixture()
    const seqContext = {subscribeProcessPhase: () => ({terminate() {}})} as unknown as EngineContext
    const sequencer = new NoteSequencer(seqContext, {uuid: UUID.generate()} as AudioUnitBoxAdapter)
    sequencer.pushRawNoteOn(64, 0.8)
    const timeline = {...note(0, Infinity), pitch: 72}
    const mixed: NoteEventSource = {
        *processNotes(a, b, flags) {yield* sequencer.processNotes(a, b, flags)},
        *iterateActiveNotesAt(p, onlyExternal) {
            yield* sequencer.iterateActiveNotesAt(p, onlyExternal)
            if (!onlyExternal) {yield timeline}
        }
    }
    const first = f.arpeggio(), second = f.arpeggio()
    first.setNoteEventSource(mixed); second.setNoteEventSource(first)
    const output = [...second.processNotes(0, 100, 0)].filter(NoteLifecycleEvent.isStart)
    expect(output.map(n => n.pitch)).toEqual([64])
    expect([...first.iterateActiveNotesAt(0, true)].map(n => n.pitch)).toEqual([64])
    first.reset(); second.reset()
    const transporting = [...second.processNotes(0, 100, BlockFlag.transporting)].filter(NoteLifecycleEvent.isStart)
    expect(transporting).toHaveLength(1)
    expect([...first.iterateActiveNotesAt(0, true)].map(n => n.pitch)).toEqual([64])
    first.reset(); second.reset(); sequencer.reset()
    expect([...second.processNotes(0, 100, 0)]).toEqual([])
})
