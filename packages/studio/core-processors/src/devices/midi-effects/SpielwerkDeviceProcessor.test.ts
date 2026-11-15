import {beforeAll, expect, it} from "vitest"
import {MIDIOutputBox, MIDIOutputDeviceBox} from "@opendaw/studio-boxes"
import {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {MIDIOutputDeviceProcessor} from "../instruments/MIDIOutputDeviceProcessor"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {BlockFlag} from "../../processing"
import {block, outputNote, ScriptBlock, ScriptEvent, eventSource} from "../script-test-fixture"
import {spielFixture} from "./spielwerk-test-fixture"

beforeAll(() => Object.assign(globalThis, {sampleRate: 48000}))
it("offers actual tempo and partial sample bounds through the EventProcessor to MIDI chain", () => {
    const seen: ScriptBlock[] = []
    const f = spielFixture(class {
        *process(b: ScriptBlock) {seen.push({...b}); yield outputNote(b.from, 1)}
    })
    const out = f.edit(() => MIDIOutputBox.create(f.graph, UUID.generate()))
    const box = f.edit(() => MIDIOutputDeviceBox.create(f.graph, UUID.generate(), b => b.device.refer(out.device)))
    const sink = new MIDIOutputDeviceProcessor(f.context, f.adapters.adapterFor(box, MIDIOutputDeviceBoxAdapter))
    sink.setNoteEventSource(f.processor)
    for (const b of [{...block(), s0: 7, s1: 31, bpm: 90}, {...block(10, 20), s0: 31, s1: 109, bpm: 147}]) {
        f.processor.process({blocks: [b]})
        sink.process({blocks: [b]})
    }
    expect(seen.map(b => [b.from, b.to, b.bpm, b.s0, b.s1])).toEqual([[0, 10, 90, 7, 31], [10, 20, 147, 31, 109]])
    expect(f.midi.length).toBeGreaterThan(0)
})

it.each([
    {position: Infinity}, {position: NaN}, {duration: Infinity}, {duration: NaN},
    {position: Number.MAX_VALUE, duration: Number.MAX_VALUE},
    {position: 1e30, duration: 1}, {pitch: 60.5}, {pitch: NaN},
    {velocity: Infinity}, {cent: Infinity}, {cent: NaN}, {cent: "10"}
])("refuses nonrepresentable note fields %j before retention", invalid => {
    const f = spielFixture(class {*process() {yield {...outputNote(), ...invalid}}})
    expect([...f.processor.processNotes(0, 10, 0)]).toEqual([])
    expect([...f.processor.iterateActiveNotesAt(0, false)]).toEqual([])
    expect(f.messages).toHaveLength(1)
    expect([...f.processor.processNotes(10, Number.MAX_VALUE, 0)]).toEqual([])
})
it("admits integral edge pitches, finite cents and optional default cents", () => {
    const f = spielFixture(class {*process() {
        yield {...outputNote(0, 1, 0), velocity: 0, cent: -1200}
        yield {...outputNote(0, 1, 127), velocity: 1, cent: undefined}
    }})
    const starts = [...f.processor.processNotes(0, 10, 0)].filter(NoteLifecycleEvent.isStart)
    expect(f.messages).toEqual([])
    expect(starts).toHaveLength(2)
})

it("cancels queued source descendants, preserves unrelated/anonymous notes, and owns due descendants", () => {
    const a = NoteLifecycleEvent.start(0, 100, 60, 1, 0)
    const b = NoteLifecycleEvent.start(0, 100, 64, 1, 0)
    const f = spielFixture(class {
        *process(context: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) {
                if (event.gate) yield outputNote(30, 100, event.pitch)
            }
            if (context.from === 0) yield outputNote(30, 100, 72)
        }
    })
    f.sourceLease.terminate()
    f.processor.setNoteEventSource(eventSource([a, b, NoteLifecycleEvent.stop(a, 10), NoteLifecycleEvent.stop(b, 40)]))
    expect([...f.processor.processNotes(0, 10, 0)]).toEqual([])
    expect([...f.processor.processNotes(10, 20, 0)]).toEqual([])
    const due = [...f.processor.processNotes(30, 40, 0)]
    expect(due.filter(NoteLifecycleEvent.isStart).map(e => e.pitch).sort()).toEqual([64, 72])
    const stops = [...f.processor.processNotes(40, 50, 0)]
    expect(stops.filter(NoteLifecycleEvent.isStop).map(e => e.pitch)).toEqual([64])
    expect([...f.processor.iterateActiveNotesAt(50, false)].map(e => e.pitch)).toEqual([72])
})
it.each(["seek", "stop"])("clears pending-only output on %s and calls reset once", action => {
    let resets = 0
    const f = spielFixture(class {
        *process(b: ScriptBlock) {if (b.from === 10) yield outputNote(50, 10)}
        reset() {resets++}
    })
    const playing = BlockFlag.transporting | BlockFlag.playing
    expect([...f.processor.processNotes(10, 20, playing)]).toEqual([])
    const flags = action === "seek" ? playing | BlockFlag.discontinuous : 0
    expect([...f.processor.processNotes(0, 10, flags)]).toEqual([])
    expect([...f.processor.processNotes(50, 60, playing)]).toEqual([])
    expect(resets).toBe(1)
})
it("quarantines a throwing reset hook without escaping the chain", () => {
    const f = spielFixture(class {
        *process() {yield outputNote(50, 10)}
        reset() {throw new Error("reset")}
    })
    Array.from(f.processor.processNotes(0, 10, 0))
    expect(() => [...f.processor.processNotes(10, 20, BlockFlag.discontinuous)]).not.toThrow()
    expect(f.messages).toHaveLength(1)
    expect([...f.processor.processNotes(50, 60, 0)]).toEqual([])
})
it("keeps scheduled starts before a same-window source stop and clips newly generated descendants", () => {
    const a = NoteLifecycleEvent.start(0, 100, 60, 1, 0)
    const f = spielFixture(class {
        *process(_b: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) if (event.gate) yield outputNote(15, 100)
        }
    })
    f.sourceLease.terminate()
    f.processor.setNoteEventSource(eventSource([a, NoteLifecycleEvent.stop(a, 18)]))
    expect([...f.processor.processNotes(0, 10, 0)]).toEqual([])
    const next = [...f.processor.processNotes(10, 20, 0)]
    expect(next.filter(NoteLifecycleEvent.isStart).map(e => e.position)).toEqual([15])
    expect(next.filter(NoteLifecycleEvent.isStop).map(e => e.position)).toEqual([18])
    const g = spielFixture(class {
        *process(_b: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) if (event.gate) {
                yield outputNote(1, 100)
                yield outputNote(30, 100)
            }
        }
    })
    g.sourceLease.terminate()
    g.processor.setNoteEventSource(eventSource([a, NoteLifecycleEvent.stop(a, 5)]))
    const same = [...g.processor.processNotes(0, 10, 0)]
    expect(same.filter(NoteLifecycleEvent.isStop).map(e => e.position)).toEqual([5])
    expect([...g.processor.processNotes(30, 40, 0)]).toEqual([])
})
