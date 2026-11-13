import {FieldKey, Fields} from "./field"
import {ByteArrayInput, ByteArrayOutput, DataInput, DataOutput} from "@opendaw/lib-std"

export namespace Serializer {
    export class DecodeError extends Error {}
    export const MAX_FIELD_BYTES = 64 * 1024 * 1024
    const MAGIC_HEADER = 0x464c4453
    export const writeFields = <FIELDS extends Fields>(output: DataOutput, fields: FIELDS) => {
        const entries = Object.entries(fields).filter(([_, field]) => !field.deprecated)
        output.writeInt(MAGIC_HEADER)
        output.writeShort(entries.length)
        entries.forEach(([key, field]) => {
            const bytes = ByteArrayOutput.create()
            field.write(bytes)
            const buffer = new Int8Array(bytes.toArrayBuffer())
            output.writeShort(Number(key))
            output.writeInt(buffer.length)
            output.writeBytes(buffer)
        })
    }

    export const readFields = <FIELDS extends Fields>(input: DataInput, fields: FIELDS) => {
        const remaining = (): number => {
            if (typeof input.remaining !== "function") {throw new DecodeError("Bounded field input required")}
            return input.remaining()
        }
        const requireBytes = (count: number): void => {
            if (count < 0 || count > remaining()) {throw new DecodeError("Invalid field frame")}
        }
        requireBytes(6)
        if (input.readInt() !== MAGIC_HEADER) {throw new DecodeError("Serializer header is corrupt")}
        const numFields = input.readShort()
        if (numFields < 0 || numFields > Math.floor(remaining() / 6)) {throw new DecodeError("Invalid field count")}
        for (let i = 0; i < numFields; i++) {
            requireBytes(6)
            const key: FieldKey = input.readShort()
            const byteLength = input.readInt()
            if (byteLength > MAX_FIELD_BYTES) {throw new DecodeError("Field frame exceeds 64 MiB")}
            requireBytes(byteLength)
            const field = Object.hasOwn(fields, key) ? fields[key] : undefined
            if (field === undefined) {
                input.skip(byteLength)
                continue
            }
            const bytes = new Int8Array(byteLength)
            input.readBytes(bytes)
            try {
                field.read(new ByteArrayInput(bytes.buffer))
            } catch {
                // Do not expose payloads or arbitrary decoder exception text.
                throw new DecodeError(`Could not decode field ${key}`)
            }
        }
    }
}
