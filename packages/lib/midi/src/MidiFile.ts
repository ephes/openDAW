import {ByteArrayInput, ByteArrayOutput} from "@opendaw/lib-std"
import {MidiTrack} from "./MidiTrack"
import {Chunk} from "./Chunk"
import {MidiFileDecoder} from "./MidiFileDecoder"

export namespace MidiFile {
    export const decoder = (buffer: ArrayBuffer): MidiFileDecoder => new MidiFileDecoder(new ByteArrayInput(buffer))
    export const encoder = (): MidiFileEncoder => new MidiFileEncoder()

    class MidiFileEncoder {
        readonly #tracks: Array<MidiTrack> = []

        addTrack(track: MidiTrack): this {
            this.#tracks.push(track)
            return this
        }

        encode(): ByteArrayOutput {
            if (this.#tracks.length < 1 || this.#tracks.length > 0xffff) {
                throw new Error("Invalid MIDI track count: expected 1 through 65535")
            }
            const output = ByteArrayOutput.create()
            output.littleEndian = false
            output.writeInt(Chunk.MTHD)
            output.writeInt(6)
            output.writeShort(this.#tracks.length > 1 ? 1 : 0) // formatType
            output.writeShort(this.#tracks.length)
            output.writeShort(96) // timeDivision
            this.#tracks.forEach(track => {
                output.writeInt(Chunk.MTRK)
                const buffer = track.encode()
                output.writeInt(buffer.byteLength)
                output.writeBytes(new Int8Array(buffer))
            })
            return output
        }
    }

}
