import {beforeAll, expect, it} from "vitest"
import {MIDIOutputBox, MIDIOutputDeviceBox} from "@opendaw/studio-boxes"
import {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {MIDIOutputDeviceProcessor} from "../instruments/MIDIOutputDeviceProcessor"
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
