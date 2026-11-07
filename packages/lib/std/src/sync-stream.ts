import {ByteArrayInput, ByteArrayOutput} from "./data"
import {panic, Procedure, Provider} from "./lang"
import {Schema} from "./schema"

export namespace SyncStream {
    const enum State {READING, READ, WRITING, WRITTEN}

    export interface Writer {
        readonly tryWrite: Provider<boolean>
    }

    export interface Reader {
        readonly buffer: SharedArrayBuffer
        readonly tryRead: Provider<boolean>
    }

    export const writer = <T extends object>(io: Schema.IO<T>, buffer: SharedArrayBuffer, populate: Procedure<T>): Writer => {
        if (io.bytesTotal + 1 > buffer.byteLength) {return panic("Insufficient memory allocated.")}
        const array = new Uint8Array(buffer)
        const output = ByteArrayOutput.use(buffer, 1)
        return {
            tryWrite: () => {
                if (Atomics.compareExchange(array, 0, State.READ, State.WRITING) === State.READ) {
                    let written = false
                    try {
                        populate(io.object)
                        output.position = 0
                        io.write(output)
                        written = true
                        return true
                    } finally {
                        Atomics.store(array, 0, written ? State.WRITTEN : State.READ)
                    }
                }
                return false
            }
        }
    }

    export const reader = <T extends object>(io: Schema.IO<T>, procedure: Procedure<T>): Reader => {
        const buffer = new SharedArrayBuffer(io.bytesTotal + 1)
        const array = new Uint8Array(buffer)
        const input = new ByteArrayInput(buffer, 1)
        Atomics.store(array, 0, State.READ)
        return {
            buffer,
            tryRead: () => {
                if (Atomics.compareExchange(array, 0, State.WRITTEN, State.READING) === State.WRITTEN) {
                    try {
                        input.position = 0
                        io.read(input)
                        procedure(io.object)
                        return true
                    } finally {
                        Atomics.store(array, 0, State.READ)
                    }
                }
                return false
            }
        }
    }
}