import {beforeAll, expect, it} from "vitest"
import {MIDIOutputBox, MIDIOutputDeviceBox} from "@opendaw/studio-boxes"
import {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {MIDIOutputDeviceProcessor} from "../instruments/MIDIOutputDeviceProcessor"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {block, outputNote, ScriptBlock} from "../script-test-fixture"
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
