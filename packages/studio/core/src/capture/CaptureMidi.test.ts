import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import {MidiData} from "@opendaw/lib-midi"
import {PPQN} from "@opendaw/lib-dsp"
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
    return {capture, signals, box, engine, loopArea}
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
    it("preserves both attacks and ends the latest retrigger at the last release", async () => {
        const {capture} = setup()
        const clock = vi.spyOn(performance, "now").mockReturnValue(0)
        capture.armed.setValue(true)
        await flush()
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.5))
        clock.mockReturnValue(250)
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.75))
        clock.mockReturnValue(375)
        capture.notify(NoteSignal.off(capture.uuid, 60))
        clock.mockReturnValue(500)
        capture.notify(NoteSignal.off(capture.uuid, 60))
        const expected = [
            {pitch: 60, velocity: 0.5, position: 0, duration: PPQN.secondsToPulses(0.25, 120)},
            {pitch: 60, velocity: 0.75, position: PPQN.secondsToPulses(0.25, 120), duration: PPQN.secondsToPulses(0.25, 120)}
        ]
        expect(capture.resolveCapture().unwrap().notes).toEqual(expected)
        expect(capture.resolveCapture().unwrap().notes).toEqual(expected)
        expect(capture.captureNoteOnCount.getValue()).toBe(2)
        capture.terminate()
    })

    it("preserves retriggers across a playback loop", async () => {
        const {capture, engine, loopArea} = setup()
        engine.isPlaying.setValue(true)
        loopArea.enabled.setValue(true)
        loopArea.to.setValue(960)
        engine.position.setValue(900)
        capture.armed.setValue(true)
        await flush()
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.5))
        engine.position.setValue(0)
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.75))
        engine.position.setValue(120)
        capture.notify(NoteSignal.off(capture.uuid, 60))
        engine.position.setValue(240)
        capture.notify(NoteSignal.off(capture.uuid, 60))
        expect(capture.resolveCapture().unwrap().notes).toEqual([
            {pitch: 60, velocity: 0.5, position: 0, duration: 60},
            {pitch: 60, velocity: 0.75, position: 60, duration: 240}
        ])
        capture.terminate()
    })

    it("retains minimum durations for coincident retriggers", async () => {
        const {capture} = setup()
        vi.spyOn(performance, "now").mockReturnValue(0)
        capture.armed.setValue(true)
        await flush()
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.5))
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.75))
        capture.notify(NoteSignal.off(capture.uuid, 60))
        capture.notify(NoteSignal.off(capture.uuid, 60))
        expect(capture.resolveCapture().unwrap().notes.map(note => note.duration))
            .toEqual([PPQN.fromSignature(1, 128), PPQN.fromSignature(1, 128)])
        capture.terminate()
    })

    it.each([
        {playing: false, released: false}, {playing: false, released: true},
        {playing: true, released: false}, {playing: true, released: true}
    ])("carries a trimmed held note into the retained window ($playing, $released)", async ({playing, released}) => {
        const {capture, engine} = setup()
        const clock = vi.spyOn(performance, "now").mockReturnValue(0)
        engine.isPlaying.setValue(playing)
        capture.armed.setValue(true)
        await flush()
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.5))
        clock.mockReturnValue(1000)
        engine.position.setValue(PPQN.secondsToPulses(1, 120))
        for (let index = 0; index < CAPTURE_MIDI_MAX_EVENTS / 2; index++) {
            capture.notify(NoteSignal.on(capture.uuid, 64, 1.0))
            capture.notify(NoteSignal.off(capture.uuid, 64))
        }
        clock.mockReturnValue(2000)
        engine.position.setValue(PPQN.secondsToPulses(2, 120))
        if (released) {capture.notify(NoteSignal.off(capture.uuid, 60))}
        const result = capture.resolveCapture().unwrap()
        const expected = {pitch: 60, velocity: 0.5, position: PPQN.secondsToPulses(1, 120), duration: PPQN.secondsToPulses(1, 120)}
        expect(result.origin).toBe(0)
        expect(result.notes.filter(note => note.pitch === 60)).toEqual([expected])
        expect(result.notes).toHaveLength(CAPTURE_MIDI_MAX_EVENTS / 2 + 1)
        expect(capture.captureNoteOnCount.getValue()).toBe(result.notes.length)
        expect(capture.resolveCapture().unwrap().notes).toEqual(result.notes)
        capture.resetCapture()
        expect(capture.resolveCapture().isEmpty()).toBe(true)
        expect(capture.captureNoteOnCount.getValue()).toBe(0)
        capture.terminate()
    })

    it("bounds carried state to MIDI pitches and ignores invalid pitches", async () => {
        const {capture} = setup()
        capture.armed.setValue(true)
        await flush()
        for (const pitch of [-1, 128, 0.5, NaN, Infinity]) {
            capture.notify(NoteSignal.on(capture.uuid, pitch, 1.0))
        }
        expect(capture.captureNoteOnCount.getValue()).toBe(0)
        for (let pitch = 0; pitch < 128; pitch++) {capture.notify(NoteSignal.on(capture.uuid, pitch, 0.5))}
        for (let index = 0; index < CAPTURE_MIDI_MAX_EVENTS; index++) {
            capture.notify(NoteSignal.on(capture.uuid, 127, 1.0))
            capture.notify(NoteSignal.off(capture.uuid, 127))
        }
        const notes = capture.resolveCapture().unwrap().notes
        expect(notes).toHaveLength(CAPTURE_MIDI_MAX_EVENTS / 2 + 128)
        expect(capture.captureNoteOnCount.getValue()).toBe(notes.length)
        expect(new Set(notes.map(note => note.pitch)).size).toBe(128)
        capture.terminate()
    })

    it("carries press counts across trimming and forgets them after the final release leaves the window", async () => {
        const {capture} = setup()
        const clock = vi.spyOn(performance, "now").mockReturnValue(0)
        capture.armed.setValue(true)
        await flush()
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.5))
        clock.mockReturnValue(1000)
        const fill = () => {
            for (let index = 0; index < CAPTURE_MIDI_MAX_EVENTS / 2; index++) {
                capture.notify(NoteSignal.on(capture.uuid, 64, 1.0))
                capture.notify(NoteSignal.off(capture.uuid, 64))
            }
        }
        fill()
        clock.mockReturnValue(2000)
        capture.notify(NoteSignal.on(capture.uuid, 60, 0.75))
        clock.mockReturnValue(3000)
        capture.notify(NoteSignal.off(capture.uuid, 60))
        clock.mockReturnValue(4000)
        capture.notify(NoteSignal.off(capture.uuid, 60))
        expect(capture.resolveCapture().unwrap().notes.filter(note => note.pitch === 60)).toEqual([
            {pitch: 60, velocity: 0.5, position: PPQN.secondsToPulses(1, 120), duration: PPQN.secondsToPulses(1, 120)},
            {pitch: 60, velocity: 0.75, position: PPQN.secondsToPulses(2, 120), duration: PPQN.secondsToPulses(2, 120)}
        ])
        fill()
        const notes = capture.resolveCapture().unwrap().notes
        expect(notes).toHaveLength(CAPTURE_MIDI_MAX_EVENTS / 2)
        expect(notes.every(note => note.pitch === 64)).toBe(true)
        expect(capture.captureNoteOnCount.getValue()).toBe(notes.length)
        capture.armed.setValue(false)
        expect(capture.resolveCapture().isEmpty()).toBe(true)
        capture.terminate()
    })

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
