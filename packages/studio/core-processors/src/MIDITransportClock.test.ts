import {expect, it, vi} from "vitest"
import {EngineContext} from "./EngineContext"
import {RootBoxAdapter} from "@opendaw/studio-adapters"
import {MIDITransportClock} from "./MIDITransportClock"
const device = (id: string, enabled = true, delay = 0) => ({id: {getValue: () => id},
    sendTransportMessages: {getValue: () => enabled}, delayInMs: {getValue: () => delay}})
it("fans out pending transport messages once, in order, retaining each delay", () => {
    const sendMIDIData = vi.fn()
    const context = {sendMIDIData, registerProcessor: () => ({terminate() {}})} as unknown as EngineContext
    const midiOutputDevices = [device("a", true, 3), device("b", true, 7), device("c", false), device("")]
    const clock = new MIDITransportClock(context, {midiOutputDevices} as unknown as RootBoxAdapter)
    const start = new Uint8Array([0xfa]), stop = new Uint8Array([0xfc])
    clock.schedule(start); clock.schedule(stop); clock.process({blocks: []})
    expect(sendMIDIData.mock.calls).toEqual([["a", start, 3], ["a", stop, 3], ["b", start, 7], ["b", stop, 7]])
    clock.process({blocks: []}); expect(sendMIDIData).toHaveBeenCalledTimes(4)
    midiOutputDevices.length = 0
    clock.schedule(start); clock.process({blocks: []})
    midiOutputDevices.push(device("d")); clock.process({blocks: []})
    expect(sendMIDIData).toHaveBeenCalledTimes(4)
})
