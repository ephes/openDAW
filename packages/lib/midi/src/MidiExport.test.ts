import {describe, expect, it, vi} from "vitest"
import {ArrayMultimap, ByteArrayOutput} from "@opendaw/lib-std"
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

describe("export admission", () => {
    it.each([NaN, Infinity, -1, 0.5, 0x10000000, 0x80000000])("rejects invalid tick/delta %s before output allocation", ticks => {
        const allocate = vi.spyOn(ByteArrayOutput, "create").mockImplementation(() => {throw new Error("output allocated")})
        try {
            expect(() => track([[0, [note(ticks)]]]).encode()).toThrow(/tick|delta/i)
            expect(allocate).not.toHaveBeenCalled()
        } finally {allocate.mockRestore()}
    })
    it("refuses unsorted per-channel input instead of repairing it silently", () => {
        expect(() => track([[0, [note(2), note(1)]]]).encode()).toThrow(/tick/i)
    })
    it.each([[127, [127]], [128, [0x81, 0]], [16383, [0xff, 0x7f]],
        [0x0fffffff, [0xff, 0xff, 0xff, 0x7f]]] as [number, number[]][])
    ("encodes canonical boundary delta %i", (ticks, delta) => {
        expect(bytes(track([[0, [note(ticks)]]])).slice(0, delta.length)).toEqual(delta)
    })
    it("allows safe absolute ticks larger than one delta", () => {
        const value = track([[0, [note(0x0fffffff), note(0x1ffffffe)]]])
        expect(roundTrip(value).controlEvents.get(0).map(event => event.ticks)).toEqual([0x0fffffff, 0x1ffffffe])
    })
    it.each([0, 65536])("rejects %i tracks before invoking any track encoder", count => {
        const encode = vi.fn(() => new ArrayBuffer(0))
        const encoder = MidiFile.encoder()
        const fake = {encode} as unknown as MidiTrack
        for (let index = 0; index < count; index++) {encoder.addTrack(fake)}
        expect(() => encoder.encode()).toThrow(/track count/i)
        expect(encode).not.toHaveBeenCalled()
    })
    it.each([1, 2])("writes the right header for %i tracks", count => {
        const encoder = MidiFile.encoder()
        for (let index = 0; index < count; index++) {encoder.addTrack(MidiTrack.createEmpty())}
        const header = new DataView(encoder.encode().toArrayBuffer() as ArrayBuffer)
        expect(header.getUint16(8)).toBe(count === 1 ? 0 : 1)
        expect(header.getUint16(10)).toBe(count)
    })
})
