import {describe, expect, it} from "vitest"
import {ArrayMultimap, ByteArrayInput, ByteArrayOutput} from "@opendaw/lib-std"
import {MidiFile} from "./MidiFile"
import {MidiFileDecoder} from "./MidiFileDecoder"
import {MidiTrack} from "./MidiTrack"
import {ControlEvent} from "./ControlEvent"
import {ControlType} from "./ControlType"
import {Channel} from "./Channel"
import {MetaType} from "./MetaType"

const end = [0, 0xff, 0x2f, 0]
const file = (tracks: number[][], options: {format?: number, count?: number, division?: number,
    lengths?: number[], chunk?: number, headerLength?: number, headerExtra?: number[]} = {}): ArrayBuffer => {
    const output = ByteArrayOutput.create()
    output.writeInt(0x4d546864)
    output.writeInt(options.headerLength ?? 6)
    output.writeShort(options.format ?? (tracks.length > 1 ? 1 : 0))
    output.writeShort(options.count ?? tracks.length)
    output.writeShort(options.division ?? 96)
    options.headerExtra?.forEach(value => output.writeByte(value))
    tracks.forEach((bytes, index) => {
        output.writeInt(options.chunk ?? 0x4d54726b)
        output.writeInt(options.lengths?.[index] ?? bytes.length)
        bytes.forEach(value => output.writeByte(value))
    })
    return output.toArrayBuffer() as ArrayBuffer
}
const events = (track: MidiTrack) => {
    const result: ControlEvent[] = []
    track.controlEvents.forEach((_, entries) => result.push(...entries))
    return result
}

describe("track chunk boundaries", () => {
    it("does not accept end-of-track bytes outside a zero-length chunk", () => {
        const decoder = MidiFile.decoder(file([end], {lengths: [0]}))
        expect(() => decoder.decode()).toThrow()
        expect(decoder.input.position).toBeLessThanOrEqual(22)
    })
    it("does not consume an adjacent track while looking for termination", () => {
        const decoder = MidiFile.decoder(file([[0, 0x90, 60, 100], end]))
        expect(() => decoder.decode()).toThrow()
        expect(decoder.input.position).toBeLessThanOrEqual(26)
    })
    it.each([-1, 100])("rejects invalid declared track length %i", length => {
        expect(() => MidiFile.decoder(file([end], {lengths: [length]})).decode()).toThrow()
    })
    it("rejects a truncated event before the next track", () => {
        const decoder = MidiFile.decoder(file([[0, 0x90, 60], end]))
        expect(() => decoder.decode()).toThrow()
        expect(decoder.input.position).toBeLessThanOrEqual(25)
    })
    it("bounds skipped meta payloads", () => {
        const decoder = MidiFile.decoder(file([[0, 0xff, 1, 12], end]))
        expect(() => decoder.decode()).toThrow()
        expect(decoder.input.position).toBeLessThanOrEqual(26)
    })
    it.each([
        {format: 3}, {format: 0, count: 2}, {count: 0}, {count: -1},
        {division: 0}, {division: -24}, {headerLength: 5}, {headerLength: -1}, {headerLength: 100}
    ])("rejects invalid header/chunk metadata %j", options => {
        expect(() => MidiFile.decoder(file([end], options)).decode()).toThrow()
    })
    it("skips bounded unknown chunks without counting them as tracks", () => {
        const original = new Uint8Array(file([end, [3, 0x90, 62, 100, ...end]]))
        const alien = [0x54, 0x45, 0x53, 0x54, 0, 0, 0, 3, 0xff, 0, 0x80]
        const buffer = new Uint8Array([
            ...original.slice(0, 14), ...alien, ...original.slice(14, 26),
            ...alien, ...original.slice(26)
        ]).buffer
        const decoded = MidiFile.decoder(buffer).decode()
        expect(decoded.tracks).toHaveLength(2)
        expect(events(decoded.tracks[1])[0].ticks).toBe(3)
        expect(events(decoded.tracks[1])[0].param0).toBe(62)
    })
    it.each([-1, 100])("rejects an out-of-bounds unknown chunk length %i", length => {
        expect(() => MidiFile.decoder(file([end], {chunk: 0x54455354, lengths: [length]})).decode()).toThrow()
    })
    it("refuses unknown chunks in place of a missing declared track", () => {
        expect(() => MidiFile.decoder(file([end], {chunk: 0x54455354})).decode()).toThrow()
    })
    it("honors a bounded extended header", () => {
        const decoded = MidiFile.decoder(file([end], {headerLength: 8, headerExtra: [0xaa, 0xbb]})).decode()
        expect(decoded.tracks).toHaveLength(1)
        expect(decoded.timeDivision).toBe(96)
    })
    it("reads the track count as an unsigned 16-bit field", () => {
        const decoded = MidiFile.decoder(file(Array.from({length: 32768}, () => end))).decode()
        expect(decoded.tracks).toHaveLength(32768)
    })
    it("rejects truncated headers", () => {
        expect(() => MidiFile.decoder(new ArrayBuffer(10)).decode()).toThrow()
    })
    it("decodes valid adjacent tracks independently", () => {
        const decoded = MidiFile.decoder(file([[0, 0x90, 60, 100, ...end], end])).decode()
        expect(decoded.tracks).toHaveLength(2)
        expect(events(decoded.tracks[0])[0].param0).toBe(60)
        expect(events(decoded.tracks[1])).toEqual([])
    })
    it.each([[0x51, 2], [0x58, 3], [0x2f, 1]])("rejects a fixed-size meta event with wrong length", (type, length) => {
        expect(() => MidiFile.decoder(file([[0, 0xff, type, length, 1, 2, 3, 4, ...end]])).decode()).toThrow()
    })
})

describe("variable-length integers", () => {
    it.each([
        [[0], 0], [[0x7f], 127], [[0x81, 0], 128], [[0xff, 0x7f], 16383],
        [[0xff, 0xff, 0xff, 0x7f], 0x0fffffff]
    ] as [number[], number][])("reads %j as %i", (bytes, value) => {
        const decoder = new MidiFileDecoder(new ByteArrayInput(new Uint8Array(bytes).buffer))
        expect(decoder.readVarLen()).toBe(value)
        expect(decoder.input.remaining()).toBe(0)
    })
    it.each([{bytes: [0xff, 0xff, 0xff, 0xff, 0x7f]}, {bytes: [0x80]}, {bytes: [0x80, 0x80, 0x80, 0x80]}])
    ("rejects overlong or truncated $bytes without consuming a fifth byte", ({bytes}) => {
        const decoder = new MidiFileDecoder(new ByteArrayInput(new Uint8Array(bytes).buffer))
        expect(() => decoder.readVarLen()).toThrow()
        expect(decoder.input.position).toBeLessThanOrEqual(Math.min(bytes.length, 4))
    })
    it("rejects an overlong event delta in the production decoder", () => {
        expect(() => MidiFile.decoder(file([[0xff, 0xff, 0xff, 0xff, 0x7f, ...end]])).decode()).toThrow()
    })
})

describe("SysEx framing and timing", () => {
    it.each([0xf0, 0xf7])("consumes the exact payload of status %i and counts its delta", status => {
        const decoded = MidiFile.decoder(file([[
            5, status, 3, 1, 2, 0xf7,
            7, 0x90, 60, 100, 9, 0x80, 60, 0, ...end
        ]])).decode()
        expect(events(decoded.tracks[0]).map(event => event.ticks)).toEqual([12, 21])
    })
    it("accepts empty and multiple complete/escaped messages", () => {
        const decoded = MidiFile.decoder(file([[
            2, 0xf0, 0, 3, 0xf7, 0, 4, 0xf0, 1, 0xf7,
            5, 0x90, 60, 100, ...end
        ]])).decode()
        expect(events(decoded.tracks[0])[0].ticks).toBe(14)
    })
    it("rejects truncated SysEx without crossing the chunk", () => {
        const decoder = MidiFile.decoder(file([[0, 0xf0, 5, 1], end]))
        expect(() => decoder.decode()).toThrow()
        expect(decoder.input.position).toBeLessThanOrEqual(26)
    })
    it.each([0xf1, 0xf2, 0xf6, 0xf8, 0xfe])("refuses unsupported system framing %i", status => {
        expect(() => MidiFile.decoder(file([[0, status, 0x2f, 0, ...end]])).decode()).toThrow()
    })
})

describe("track export termination", () => {
    it.each([{ticks: []}, {ticks: [0, 12]}, {ticks: [5, 17, 100, 130]}])
    ("round trips event ticks $ticks with one terminal event", ({ticks}) => {
        const notes = ticks.map((tick, index) => new ControlEvent(tick,
            index % 2 === 0 ? ControlType.NOTE_ON : ControlType.NOTE_OFF, 60, index % 2 === 0 ? 100 : 0))
        const track = new MidiTrack(new ArrayMultimap<Channel, ControlEvent>([[0, notes]]), [])
        const buffer = MidiFile.encoder().addTrack(track).encode().toArrayBuffer() as ArrayBuffer
        const bytes = new Uint8Array(buffer)
        expect(Array.from(bytes.slice(-4))).toEqual(end)
        expect(new DataView(buffer).getUint32(18)).toBe(bytes.length - 22)
        const decoded = MidiFile.decoder(buffer).decode().tracks[0]
        expect(events(decoded).map(event => event.ticks)).toEqual(ticks)
        const terminals = decoded.metaEvents.filter(event => event.type === MetaType.END_OF_TRACK)
        expect(terminals).toHaveLength(1)
        expect(terminals[0].ticks).toBe(ticks.at(-1) ?? 0)
    })
    it("terminates every track in a multitrack file", () => {
        const buffer = MidiFile.encoder().addTrack(MidiTrack.createEmpty()).addTrack(MidiTrack.createEmpty())
            .encode().toArrayBuffer() as ArrayBuffer
        const decoded = MidiFile.decoder(buffer).decode()
        expect(decoded.formatType).toBe(1)
        expect(decoded.tracks.map(track => track.metaEvents.length)).toEqual([1, 1])
    })
})
