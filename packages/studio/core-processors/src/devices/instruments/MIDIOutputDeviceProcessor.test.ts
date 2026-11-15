import {beforeAll, expect, it} from "vitest"
import {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {MIDIOutputBox, MIDIOutputDeviceBox} from "@opendaw/studio-boxes"
import {UUID} from "@opendaw/lib-std"
import {MidiData} from "@opendaw/lib-midi"
import {MIDIOutputDeviceProcessor} from "./MIDIOutputDeviceProcessor"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {block, deviceFixture, eventSource} from "../script-test-fixture"

beforeAll(() => Object.assign(globalThis, {sampleRate: 48000}))
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
    return {...f, a, b, box, processor}
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
