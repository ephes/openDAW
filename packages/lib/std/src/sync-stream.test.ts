import {describe, expect, it, vi} from "vitest"
import {ByteArrayInput, ByteArrayOutput} from "./data"
import {SyncStream} from "./sync-stream"
import {Schema} from "./schema"

const makeIO = (): Schema.IO<{n: number}> => ({
    bytesTotal: 4,
    object: {n: 0},
    write(output: ByteArrayOutput) {output.writeInt(this.object.n)},
    read(input: ByteArrayInput) {this.object.n = input.readInt()}
})

describe("SyncStream ownership", () => {
    it("claims each transition exactly once and excludes competing/reentrant owners", () => {
        const consumer = vi.fn(() => expect(reader.tryRead()).toBe(false))
        const reader = SyncStream.reader(makeIO(), consumer)
        expect(reader.tryRead()).toBe(false)
        const writer = SyncStream.writer(makeIO(), reader.buffer, object => {
            expect(writer.tryWrite()).toBe(false)
            expect(competitor.tryWrite()).toBe(false)
            expect(reader.tryRead()).toBe(false)
            object.n = 42
        })
        const competitor = SyncStream.writer(makeIO(), reader.buffer, () => undefined)
        expect(writer.tryWrite()).toBe(true)
        expect(writer.tryWrite()).toBe(false)
        expect(competitor.tryWrite()).toBe(false)
        expect(reader.tryRead()).toBe(true)
        expect(consumer).toHaveBeenCalledExactlyOnceWith({n: 42})
        expect(reader.tryRead()).toBe(false)
        expect(writer.tryWrite()).toBe(true)
        expect(reader.tryRead()).toBe(true)
    })
    it("constructing another writer cannot release a held frame", () => {
        const reader = SyncStream.reader(makeIO(), () => undefined)
        const writer = SyncStream.writer(makeIO(), reader.buffer, () => {
            const competitor = SyncStream.writer(makeIO(), reader.buffer, () => undefined)
            expect(competitor.tryWrite()).toBe(false)
        })
        expect(writer.tryWrite()).toBe(true)
    })
    it.each(["populate", "write", "read", "consumer"] as const)("recovers from %s errors", stage => {
        const error = new Error("synthetic failure")
        let fail = true
        const maybeThrow = (where: typeof stage) => {
            if (fail && stage === where) {fail = false; throw error}
        }
        const outputIO = makeIO()
        const inputIO = makeIO()
        const originalWrite = outputIO.write.bind(outputIO)
        outputIO.write = output => {
            if (stage === "write" && fail) {output.writeByte(99); maybeThrow("write")}
            originalWrite(output)
        }
        const originalRead = inputIO.read.bind(inputIO)
        inputIO.read = input => {maybeThrow("read"); originalRead(input)}
        const received: number[] = []
        const reader = SyncStream.reader(inputIO, object => {maybeThrow("consumer"); received.push(object.n)})
        const writer = SyncStream.writer(outputIO, reader.buffer, object => {maybeThrow("populate"); object.n = 17})
        if (stage === "populate" || stage === "write") {
            expect(() => writer.tryWrite()).toThrow(error)
            expect(reader.tryRead()).toBe(false)
        } else {
            expect(writer.tryWrite()).toBe(true)
            expect(() => reader.tryRead()).toThrow(error)
        }
        expect(writer.tryWrite()).toBe(true)
        expect(reader.tryRead()).toBe(true)
        expect(received).toEqual([17])
    })
    it("rejects insufficient buffers", () => {
        expect(() => SyncStream.writer(makeIO(), new SharedArrayBuffer(1), () => undefined)).toThrow()
    })
})
