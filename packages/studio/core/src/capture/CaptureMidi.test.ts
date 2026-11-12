import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import {MidiData} from "@opendaw/lib-midi"
import {NoteSignal} from "@opendaw/studio-adapters"
import {CaptureMidi} from "./CaptureMidi"
import {MidiDevices} from "../midi"

vi.mock("./RecordMidi", () => ({RecordMidi: {start: vi.fn()}}))

class CountingInput extends EventTarget {
    listeners = 0
    addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {this.listeners++; super.addEventListener(...args)}
    removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {this.listeners--; super.removeEventListener(...args)}
}

let input: CountingInput
beforeEach(() => {
    input = new CountingInput()
    vi.spyOn(MidiDevices, "inputDevices").mockReturnValue([input as unknown as MIDIInput])
})
afterEach(() => vi.restoreAllMocks())

const setup = () => {
    const signals: Array<NoteSignal> = []
    const engine = {
        noteSignal: (signal: NoteSignal) => signals.push(signal),
        isPlaying: new DefaultObservableValue(false), isRecording: new DefaultObservableValue(false),
        position: new DefaultObservableValue(0)
    }
    const loopArea = {enabled: new DefaultObservableValue(false), from: new DefaultObservableValue(0), to: new DefaultObservableValue(0)}
    const manager = {project: {engine, timelineBox: {loopArea, bpm: new DefaultObservableValue(120)}}}
    const unit = {address: {uuid: UUID.generate()}}
    const box = {channel: new DefaultObservableValue(-1), deviceId: new DefaultObservableValue("")}
    type Args = ConstructorParameters<typeof CaptureMidi>
    const capture = new CaptureMidi(manager as unknown as Args[0], unit as unknown as Args[1], box as unknown as Args[2])
    return {capture, signals, box}
}

const send = (data: Uint8Array) => input.dispatchEvent(new MessageEvent("midimessage", {data}))
const flush = async () => {for (let index = 0; index < 4; index++) {await Promise.resolve()}}

describe("queued MIDI stream fence", () => {
    it("does not open a stream queued before a disarm", async () => {
        const {capture, signals} = setup()
        capture.armed.setValue(true)
        capture.armed.setValue(false)
        await flush()
        send(MidiData.noteOn(0, 60, 100))
        expect(signals).toHaveLength(0)
        expect(input.listeners).toBe(0)
    })

    it("does not open a stream queued by a channel change before a disarm", async () => {
        const {capture, signals, box} = setup()
        capture.armed.setValue(true)
        await flush()
        box.channel.setValue(2)
        capture.armed.setValue(false)
        await flush()
        send(MidiData.noteOn(2, 60, 100))
        expect(signals).toHaveLength(0)
    })

    it("does not open a stream queued before termination", async () => {
        const {capture, signals} = setup()
        capture.armed.setValue(true)
        capture.terminate()
        await flush()
        send(MidiData.noteOn(0, 60, 100))
        expect(signals).toHaveLength(0)
        expect(input.listeners).toBe(0)
    })

    it("opens the stream while armed", async () => {
        const {capture, signals} = setup()
        capture.armed.setValue(true)
        await flush()
        send(MidiData.noteOn(0, 60, 100))
        expect(signals.map(signal => signal.type)).toEqual(["note-on"])
        capture.terminate()
    })
})
