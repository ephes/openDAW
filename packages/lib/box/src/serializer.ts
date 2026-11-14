import {Field, FieldKey, Fields} from "./field"
import {ByteArrayInput, ByteArrayOutput, ByteCounter, DataInput, DataOutput, isDefined, tryCatch} from "@opendaw/lib-std"

export namespace Serializer {
    export class DecodeError extends Error {}
    export class EncodeError extends Error {}
    export const MAX_FIELD_BYTES = 64 * 1024 * 1024
    export const MAX_FIELDS = 32767
    export const isFieldKey = (key: string): boolean => {
        const value = Number(key)
        return Number.isInteger(value) && value >= -32768 && value <= 32767 && String(value) === key
    }
    const MAGIC_HEADER = 0x464c4453
    export const writeFields = <FIELDS extends Fields>(output: DataOutput, fields: FIELDS) => {
        const entries = Object.entries(fields).filter(([_, field]) => !field.deprecated)
        if (entries.length > MAX_FIELDS) {throw new EncodeError("Invalid field count")}
        entries.forEach(([key]) => {
            if (!isFieldKey(key)) {throw new EncodeError("Invalid field key")}
        })
        entries.forEach(([_, field]) => {
            const counter = new ByteCounter()
            field.write(counter)
            if (counter.count > MAX_FIELD_BYTES) {throw new EncodeError("Field frame exceeds 64 MiB")}
        })
        output.writeInt(MAGIC_HEADER)
        output.writeShort(entries.length)
        entries.forEach(([key, field]) => {
            const bytes = ByteArrayOutput.create()
            field.write(bytes)
            if (bytes.position > MAX_FIELD_BYTES) {throw new EncodeError("Field frame exceeds 64 MiB")}
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
        const seen = new Set<FieldKey>()
        const frames: Array<{key: FieldKey, field: Field, bytes: Int8Array}> = []
        for (let i = 0; i < numFields; i++) {
            requireBytes(6)
            const key: FieldKey = input.readShort()
            if (seen.has(key)) {throw new DecodeError("Duplicate field key")}
            seen.add(key)
            const byteLength = input.readInt()
            if (byteLength > MAX_FIELD_BYTES) {throw new DecodeError("Field frame exceeds 64 MiB")}
            requireBytes(byteLength)
            const field = Object.hasOwn(fields, key) ? fields[key] : undefined
            if (!isDefined(field)) {
                input.skip(byteLength)
                continue
            }
            const bytes = new Int8Array(byteLength)
            input.readBytes(bytes)
            frames.push({key, field, bytes})
        }
        frames.forEach(({key, field, bytes}) => {
            const frame = new ByteArrayInput(bytes.buffer)
            const result = tryCatch(() => {
                field.read(frame)
                if (frame.remaining() !== 0) {throw new DecodeError("Unconsumed field bytes")}
            })
            // Do not expose payloads or arbitrary decoder exception text.
            if (result.status === "failure") {throw new DecodeError(`Could not decode field ${key}`)}
        })
    }
}
