import {describe, expect, it} from "vitest"
import {ArrayMultimap} from "@opendaw/lib-std"
import {MidiFile} from "./MidiFile"
import {MidiTrack} from "./MidiTrack"
import {Channel} from "./Channel"
import {ControlEvent} from "./ControlEvent"
import {ControlType} from "./ControlType"
import {MetaType} from "./MetaType"

const track = (entries: [Channel, ControlEvent[]][]) => new MidiTrack(new ArrayMultimap(entries), [])
const bytes = (value: MidiTrack) => Array.from(new Uint8Array(value.encode()))
const roundTrip = (value: MidiTrack) => MidiFile.decoder(MidiFile.encoder().addTrack(value).encode()
    .toArrayBuffer() as ArrayBuffer).decode().tracks[0]
const note = (ticks: number) => new ControlEvent(ticks, ControlType.NOTE_ON, 60, 100)

describe("channel event export", () => {
    it("merges interleaved channels and orders simultaneous channels numerically", () => {
        const value = track([[1, [note(3), note(9)]], [0, [note(0), note(3), note(6)]]])
        expect(bytes(value)).toEqual([
            0, 0x90, 60, 100, 3, 0x90, 60, 100, 0, 0x91, 60, 100,
            3, 0x90, 60, 100, 3, 0x91, 60, 100, 0, 0xff, 0x2f, 0
        ])
        const decoded = roundTrip(value)
        expect(decoded.controlEvents.get(0).map(event => event.ticks)).toEqual([0, 3, 6])
        expect(decoded.controlEvents.get(1).map(event => event.ticks)).toEqual([3, 9])
    })
    it("retains explicit release velocity and zero velocity note-on", () => {
        const notes = [note(0), new ControlEvent(5, ControlType.NOTE_OFF, 60, 64),
            new ControlEvent(6, ControlType.NOTE_ON, 61, 0)]
        expect(roundTrip(track([[2, notes]])).controlEvents.get(2)).toEqual(notes)
        expect(bytes(track([[2, notes]])).slice(4, 8)).toEqual([5, 0x82, 60, 64])
    })
    it("serializes all seven channel message kinds with their exact lengths", () => {
        const controls = [new ControlEvent(0, ControlType.PROGRAM_CHANGE, 7, 0),
            new ControlEvent(1, ControlType.CONTROLLER, 64, 127),
            new ControlEvent(2, ControlType.PITCH_BEND, 0, 64),
            new ControlEvent(3, ControlType.NOTE_AFTER_TOUCH, 60, 32),
            new ControlEvent(4, ControlType.CHANNEL_AFTER_TOUCH, 63, 0), note(5),
            new ControlEvent(6, ControlType.NOTE_OFF, 60, 64)]
        expect(bytes(track([[0, controls]]))).toEqual([
            0, 0xc0, 7, 1, 0xb0, 64, 127, 1, 0xe0, 0, 64, 1, 0xa0, 60, 32,
            1, 0xd0, 63, 1, 0x90, 60, 100, 1, 0x80, 60, 64, 0, 0xff, 0x2f, 0
        ])
        expect(roundTrip(track([[0, controls]])).controlEvents.get(0)).toEqual(controls)
    })
    it("refuses unknown event kinds", () => {
        expect(() => track([[0, [new ControlEvent(0, 0x70 as ControlType, 1, 2)]]]).encode()).toThrow()
    })
    it("preserves decoded tempo/signature changes and the terminal tick", () => {
        // Hand-authored SMF: tempo 120 -> 100 BPM, signature 4/4 -> 3/8, note, EOT.
        const body = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0, 0xff, 0x58, 4, 4, 2, 24, 8,
            10, 0xff, 0x51, 3, 9, 0x27, 0xc0, 0, 0xff, 0x58, 4, 3, 3, 24, 8,
            2, 0x90, 60, 100, 8, 0xff, 0x2f, 0]
        const fixture = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
            0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]).buffer
        const decoded = MidiFile.decoder(fixture).decode().tracks[0]
        expect(bytes(decoded)).toEqual(body)
        expect(roundTrip(decoded).metaEvents).toEqual(decoded.metaEvents)
        expect(roundTrip(decoded).metaEvents.filter(event => event.type === MetaType.END_OF_TRACK)).toHaveLength(1)
    })
})
