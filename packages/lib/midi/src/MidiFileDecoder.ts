import {byte, ByteArrayInput, int} from "@opendaw/lib-std"
import {MidiFileFormat} from "./MidiFileFormat"
import {Chunk} from "./Chunk"
import {MidiTrack} from "./MidiTrack"

export class MidiFileDecoder {
    readonly input: ByteArrayInput

    #suppressWarnings: boolean = false
    #trackStart: int = 0
    #trackEnd: int

    constructor(input: ByteArrayInput) {
        this.input = input
        this.#trackEnd = input.position + input.remaining()
    }

    decode(): MidiFileFormat {
        this.#require(14)
        this.input.littleEndian = false
        const header = this.input.readInt()
        if (header !== Chunk.MTHD) {
            console.warn(`Unsupported midi format ${header} !== ${Chunk.MTHD}`)
            throw new Error("Unsupported midi format")
        }
        const headerLength = this.input.readInt()
        if (headerLength < 6 || headerLength > this.input.remaining()) {throw new Error("Invalid MIDI header length")}
        const formatType = this.input.readShort()
        const numTracks = this.input.readShort() & 0xffff
        const timeDivision = this.input.readShort()
        if (formatType < 0 || formatType > 2 || numTracks <= 0 || (formatType === 0 && numTracks !== 1)) {
            throw new Error("Invalid MIDI format or track count")
        }
        if (timeDivision <= 0) {throw new Error("Unsupported MIDI time division: positive PPQN required")}
        this.skip(headerLength - 6)
        const fileEnd = this.#trackEnd
        const tracks: MidiTrack[] = []
        while (tracks.length < numTracks) {
            this.#require(8)
            const trackChunk = this.input.readInt()
            const trackLength = this.input.readInt()
            const trackPosition = this.input.position
            if (trackLength < 0 || trackLength > this.input.remaining()) {throw new Error("Invalid MIDI track length")}
            if (trackChunk !== Chunk.MTRK) {
                this.skip(trackLength)
                continue
            }
            this.#trackStart = trackPosition
            this.#trackEnd = trackPosition + trackLength
            tracks.push(MidiTrack.decode(this))
            this.input.position = trackPosition + trackLength
            this.#trackStart = 0
            this.#trackEnd = fileEnd
        }
        if (0 < this.input.remaining()) {
            console.warn(`${this.input.remaining()} bytes remaining.`)
        }
        return new MidiFileFormat(tracks, formatType, timeDivision)
    }

    readVarLen(): int {
        let value: int = 0
        for (let index = 0; index < 4; index++) {
            const current = this.readByte() & 0xff
            value = value * 128 + (current & 0x7f)
            if ((current & 0x80) === 0) {return value}
        }
        throw new Error("MIDI variable-length integer exceeds four bytes")
    }

    readSignature(): [int, int] {
        const b0 = this.readByte() & 0xff
        const b1 = this.readByte() & 0xff
        const b2 = this.readByte() & 0xff
        const b3 = this.readByte() & 0xff
        if (!this.#suppressWarnings) {
            if (24 !== b2) {
                // Unsupported Metronome Pulse.
            }
            if (8 !== b3) {
                // Unsupported Number of 32nd notes each quarter note.
            }
        }
        return [b0, 1 << b1]
    }

    readTempo(): number {
        const b0 = this.readByte() & 0xff
        const b1 = this.readByte() & 0xff
        const b2 = this.readByte() & 0xff
        const MICROSECONDS_PER_MINUTE = 60_000_000.0 as const
        return MICROSECONDS_PER_MINUTE / ((b0 << 16) | (b1 << 8) | b2)
    }

    skipSysEx(value: int): void {
        if (value !== 0xf0 && value !== 0xf7) {throw new Error("Unsupported MIDI system event")}
        this.skip(this.readVarLen())
    }
    skip(count: int): void {
        this.#require(count)
        this.input.skip(count)
    }
    readByte(): byte {
        this.#require(1)
        return this.input.readByte()
    }
    #require(count: int): void {
        const position = this.input.position + count
        if (!Number.isInteger(count) || position < this.#trackStart || position > this.#trackEnd) {
            throw new Error("Unexpected end of MIDI chunk or invalid event length")
        }
    }
}
