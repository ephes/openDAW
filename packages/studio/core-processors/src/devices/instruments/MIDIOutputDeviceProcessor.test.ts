import {beforeAll, expect, it} from "vitest"
import {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {MIDIOutputBox, MIDIOutputDeviceBox, MIDIOutputParameterBox} from "@opendaw/studio-boxes"
import {UUID} from "@opendaw/lib-std"
import {AutomatableParameter} from "../../AutomatableParameter"
import {PPQN} from "@opendaw/lib-dsp"
import {MidiData} from "@opendaw/lib-midi"
import {MIDIOutputDeviceProcessor} from "./MIDIOutputDeviceProcessor"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {block, deviceFixture, eventSource} from "../script-test-fixture"

beforeAll(() => {Object.assign(globalThis, {sampleRate: 48000})})
function fixture() {
    const f = deviceFixture()
    const a = f.edit(() => MIDIOutputBox.create(f.graph, UUID.generate(), b => {b.id.setValue("A"); b.delayInMs.setValue(7)}))
    const b = f.edit(() => MIDIOutputBox.create(f.graph, UUID.generate(), b => b.id.setValue("B")))
    const box = f.edit(() => MIDIOutputDeviceBox.create(f.graph, UUID.generate(), b => b.device.refer(a.device)))
    const processor = new MIDIOutputDeviceProcessor(f.context, f.adapters.adapterFor(box, MIDIOutputDeviceBoxAdapter))
    const start = NoteLifecycleEvent.start(0, 100, 60, 1, 0)
    processor.setNoteEventSource(eventSource([start, NoteLifecycleEvent.stop(start, 20)]))
    processor.process({blocks: [block()]})
    expect(f.midi.map(m => m.data)).toEqual([MidiData.noteOn(0, 60, 127)])
    return {...f, a, b, box, processor, start}
}
it.each(["reset", "disable", "terminate"])("retires held notes exactly once on %s", action => {
    const f = fixture()
    if (action === "disable") f.edit(() => f.box.enabled.setValue(false))
    else if (action === "terminate") f.processor.terminate()
    else f.processor.reset()
    f.processor.reset()
    expect(f.midi).toEqual([
        {id: "A", data: MidiData.noteOn(0, 60, 127), time: 7},
        {id: "A", data: MidiData.noteOff(0, 60), time: 7}
    ])
})
it.each(["device", "id", "channel", "disconnect"])("retires the old route on %s and ignores its later stop", action => {
    const f = fixture()
    f.edit(() => {
        if (action === "device") f.box.device.refer(f.b.device)
        if (action === "id") f.a.id.setValue("B")
        if (action === "channel") f.box.channel.setValue(3)
        if (action === "disconnect") f.box.device.defer()
    })
    expect(f.midi[1]).toEqual({id: "A", data: MidiData.noteOff(0, 60), time: 7})
    f.processor.process({blocks: [block(20, 30)]})
    f.processor.reset()
    expect(f.midi).toHaveLength(2)
    f.processor.terminate()
})

it.each([0, 17, -17])("uses additive note/control timing with delay %s", delay => {
    const f = fixture()
    // The schema currently clamps negative delays; override only that field's read
    // to exercise the sender's existing negative timestamp policy.
    f.a.delayInMs.getValue = () => delay
    const paramBox = f.edit(() => MIDIOutputParameterBox.create(f.graph, UUID.generate(), b => b.owner.refer(f.box.parameters)))
    const parameter = new AutomatableParameter(f.context, f.processor.adapter.parameters.parameterAt(paramBox.value.address))
    f.midi.length = 0
    const start = NoteLifecycleEvent.start(12, 100, 64, 1, 0)
    f.processor.setNoteEventSource(eventSource([start]))
    const b = {...block(10, 20), s0: 12}
    f.processor.process({blocks: [b]})
    f.processor.parameterChanged(parameter, b.s0 / sampleRate + PPQN.pulsesToSeconds(2, b.bpm))
    expect(f.midi).toHaveLength(2)
    expect(f.midi[1].time).toBeCloseTo(f.midi[0].time)
})
it("keeps new-route notes independent of old same-pitch releases", () => {
    const f = fixture()
    f.edit(() => f.box.device.refer(f.b.device))
    const fresh = NoteLifecycleEvent.start(20, 10, 60, 1, 0)
    f.processor.setNoteEventSource(eventSource([NoteLifecycleEvent.stop(f.start, 20), fresh, NoteLifecycleEvent.stop(fresh, 30)]))
    f.processor.process({blocks: [block(20, 30)]})
    f.processor.process({blocks: [block(30, 40)]})
    f.processor.reset()
    expect(f.midi.map(m => [m.id, m.data])).toEqual([
        ["A", MidiData.noteOn(0, 60, 127)], ["A", MidiData.noteOff(0, 60)],
        ["B", MidiData.noteOn(0, 60, 127)], ["B", MidiData.noteOff(0, 60)]
    ])
})
