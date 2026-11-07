import {ByteCounter, DataInput, DataOutput} from "./data"
import {assert, int} from "./lang"

/**
 * Schema defines a fixed structure for numbers and boolean
 */
export namespace Schema {
    type Schema<T> = { [K in keyof T]: (Serializer<T[K]> | Schema<T[K]>) }

    abstract class Serializer<T> {
        abstract read(input: DataInput, previousValue: T): T
        abstract write(output: DataOutput, value: T): void
        abstract initialValue(): T
    }

    export const createBuilder = <T>(schema: Readonly<Schema<T>>): () => IO<T> => {
        const replace = <T>(schema: Schema<T>): T => {
            const clone = (schema instanceof Array ? [] : {}) as Record<string, unknown>
            Object.entries(schema).forEach(([key, value]: [string, unknown]): void => {
                if (value instanceof Serializer) {
                    clone[key] = value.initialValue()
                } else if (typeof value === "object") {
                    clone[key] = replace(value as Schema<unknown>)
                }
            })
            return clone as T
        }
        return () => new IOImpl<T>(schema, Object.seal(replace(schema)))
    }

    export const bool = new class extends Serializer<boolean> {
        read(input: DataInput): boolean {return input.readByte() === 1}
        write(output: DataOutput, value: boolean): void {output.writeByte(value ? 1 : 0)}
        initialValue(): boolean {return false}
    }

    export const int8 = new class extends Serializer<number> {
        read(input: DataInput): number {return input.readByte()}
        write(output: DataOutput, value: number): void {output.writeByte(value)}
        initialValue(): number {return 0}
    }

    export const int16 = new class extends Serializer<number> {
        read(input: DataInput): number {return input.readShort()}
        write(output: DataOutput, value: number): void {output.writeShort(value)}
        initialValue(): number {return 0}
    }

    export const int32 = new class extends Serializer<number> {
        read(input: DataInput): number {return input.readInt()}
        write(output: DataOutput, value: number): void {output.writeInt(value)}
        initialValue(): number {return 0}
    }

    export const float = new class extends Serializer<number> {
        read(input: DataInput): number {return input.readFloat()}
        write(output: DataOutput, value: number): void {output.writeFloat(value)}
        initialValue(): number {return 0.0}
    }

    export const double = new class extends Serializer<number> {
        read(input: DataInput): number {return input.readDouble()}
        write(output: DataOutput, value: number): void {output.writeDouble(value)}
        initialValue(): number {return 0.0}
    }

    export const int64 = new class extends Serializer<bigint> {
        read(input: DataInput): bigint {return input.readLong()}
        write(output: DataOutput, value: bigint): void {output.writeLong(value)}
        initialValue(): bigint {return 0n}
    }

    export const floats = (length: int) => new class extends Serializer<Float32Array> {
        read(input: DataInput, values: Float32Array): Float32Array {
            assert(values instanceof Float32Array && values.length === length, "Invalid fixed array type or length")
            for (let i = 0; i < values.length; i++) {values[i] = input.readFloat()}
            return values
        }
        write(output: DataOutput, values: Float32Array): void {
            assert(values instanceof Float32Array && values.length === length, "Invalid fixed array type or length")
            for (let i = 0; i < values.length; i++) {output.writeFloat(values[i])}
        }
        initialValue(): Float32Array {return new Float32Array(length)}
    }

    export const doubles = (length: int) => new class extends Serializer<Float64Array> {
        read(input: DataInput, values: Float64Array): Float64Array {
            assert(values instanceof Float64Array && values.length === length, "Invalid fixed array type or length")
            for (let i = 0; i < values.length; i++) {values[i] = input.readDouble()}
            return values
        }
        write(output: DataOutput, values: Float64Array): void {
            assert(values instanceof Float64Array && values.length === length, "Invalid fixed array type or length")
            for (let i = 0; i < values.length; i++) {output.writeDouble(values[i])}
        }
        initialValue(): Float64Array {return new Float64Array(length)}
    }

    export interface IO<T> {
        read(input: DataInput): void
        write(output: DataOutput): void

        get object(): T
        get bytesTotal(): int
    }

    class IOImpl<T> implements IO<T> {
        readonly #schema: Schema<T>
        readonly #object: T
        readonly #bytesTotal: int

        constructor(schema: Schema<T>, object: T) {
            this.#schema = schema
            this.#object = object
            this.#bytesTotal = this.#count()
        }

        get object(): T {return this.#object}
        get bytesTotal(): int {return this.#bytesTotal}

        read(input: DataInput): void {
            const collector = <T>(schema: Schema<T>, object: T) => {
                Object.entries(schema).forEach(([key, value]: [string, unknown]): void => {
                    const data = object as Record<string, unknown>
                    if (value instanceof Serializer) {
                        data[key] = value.read(input, data[key])
                    } else if (typeof value === "object") {
                        collector(value as Schema<unknown>, data[key])
                    }
                })
            }
            collector(this.#schema, this.#object)
        }

        write(output: DataOutput): void {
            const collector = <T>(schema: Schema<T>, object: T) => {
                Object.entries(schema).forEach(([key, value]: [string, unknown]): void => {
                    const data = object as Record<string, unknown>
                    if (value instanceof Serializer) {
                        value.write(output, data[key])
                    } else if (typeof value === "object") {
                        collector(value as Schema<unknown>, data[key])
                    }
                })
            }
            collector(this.#schema, this.#object)
        }

        #count(): int {
            const counter = new ByteCounter()
            this.write(counter)
            return counter.count
        }
    }
}