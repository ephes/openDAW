import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import {MidiData} from "@opendaw/lib-midi"
import {NoteSignal} from "@opendaw/studio-adapters"
import {CAPTURE_MIDI_MAX_EVENTS, CaptureMidi} from "./CaptureMidi"
import {MidiDevices} from "../midi"

vi.mock("./RecordMidi", () => ({RecordMidi: {start: vi.fn()}}))

class CountingInput extends EventTarget {
    listeners = 0
    addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {this.listeners++; super.addEventListener(...args)}
    removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {this.listeners--; super.removeEventListener(...args)}
}

let input: CountingInput
let second: CountingInput
beforeEach(() => {
    input = new CountingInput()
    second = new CountingInput()
    vi.spyOn(MidiDevices, "inputDevices").mockReturnValue([input, second] as unknown as ReadonlyArray<MIDIInput>)
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

const send = (data: Uint8Array, target: EventTarget = input) => target.dispatchEvent(new MessageEvent("midimessage", {data}))
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

describe("MIDI input note ownership", () => {
    const armed = async () => {
        const context = setup()
        context.capture.armed.setValue(true)
        await flush()
        return context
    }
    const types = (signals: ReadonlyArray<NoteSignal>) => signals.map(signal => signal.type)

    it("ignores a release from another channel", async () => {
        const {capture, signals} = await armed()
        send(MidiData.noteOn(0, 60, 100))
        send(MidiData.noteOff(1, 60))
        expect(types(signals)).toEqual(["note-on"])
        send(MidiData.noteOff(0, 60))
        expect(types(signals)).toEqual(["note-on", "note-off"])
        capture.terminate()
    })

    it("ignores a release from another input", async () => {
        const {capture, signals} = await armed()
        send(MidiData.noteOn(0, 60, 100))
        send(MidiData.noteOff(0, 60), second)
        expect(types(signals)).toEqual(["note-on"])
        capture.terminate()
    })

    it("releases each held press exactly once when the stream closes", async () => {
        const {capture, signals} = await armed()
        send(MidiData.noteOn(0, 60, 100))
        send(MidiData.noteOn(3, 60, 100))
        send(MidiData.noteOn(0, 64, 100), second)
        signals.length = 0
        capture.armed.setValue(false)
        expect(signals.map(signal => [signal.type, signal.pitch])).toEqual([["note-off", 60], ["note-off", 60], ["note-off", 64]])
        capture.terminate()
    })

    it("keeps ownership beyond 127 presses of one key", async () => {
        const {capture, signals} = await armed()
        for (let index = 0; index < 200; index++) {send(MidiData.noteOn(0, 60, 100))}
        for (let index = 0; index < 200; index++) {send(MidiData.noteOff(0, 60))}
        expect(signals.filter(NoteSignal.isOff)).toHaveLength(200)
        capture.terminate()
    })
})

describe("retrospective MIDI history", () => {
    it("bounds buffered events and keeps the newest notes", async () => {
        const {capture} = setup()
        capture.armed.setValue(true)
        await flush()
        const presses = CAPTURE_MIDI_MAX_EVENTS
        for (let index = 0; index < presses; index++) {
            const pitch = index % 128
            capture.notify(NoteSignal.on(capture.uuid, pitch, 1.0))
            capture.notify(NoteSignal.off(capture.uuid, pitch))
        }
        const notes = capture.resolveCapture().unwrap().notes
        expect(notes).toHaveLength(CAPTURE_MIDI_MAX_EVENTS / 2)
        expect(capture.captureNoteOnCount.getValue()).toBe(CAPTURE_MIDI_MAX_EVENTS / 2)
        expect(notes.at(-1)?.pitch).toBe((presses - 1) % 128)
        capture.terminate()
    })

    it("keeps every event below the bound", async () => {
        const {capture} = setup()
        capture.armed.setValue(true)
        await flush()
        for (let index = 0; index < 10; index++) {
            capture.notify(NoteSignal.on(capture.uuid, 60, 1.0))
            capture.notify(NoteSignal.off(capture.uuid, 60))
        }
        expect(capture.resolveCapture().unwrap().notes).toHaveLength(10)
        expect(capture.captureNoteOnCount.getValue()).toBe(10)
        capture.terminate()
    })
})
