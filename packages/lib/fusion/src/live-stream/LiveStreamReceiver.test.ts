import {afterEach, describe, expect, it, vi} from "vitest"
import {ByteArrayOutput, UUID} from "@opendaw/lib-std"
import {Address} from "@opendaw/lib-box"
import {Messenger, Port} from "@opendaw/lib-runtime"
import {LiveStreamReceiver} from "./LiveStreamReceiver"
import {Flags} from "./Flags"
import {Lock} from "./Lock"
import {PackageType} from "./PackageType"

const address = Address.compose(UUID.Lowest, 1)
const scalar = Address.compose(UUID.Lowest, 2)
const disposals: Array<() => void> = []
afterEach(() => {disposals.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals()})

const fixture = () => {
    const port: Port = {onmessage: null, onmessageerror: null, postMessage: vi.fn()}
    const messenger = Messenger.for(port)
    const receiver = new LiveStreamReceiver()
    const connection = receiver.connect(messenger)
    disposals.push(() => {connection.terminate(); messenger.terminate()})
    const send = (func: string, value: unknown) => port.onmessage?.(new MessageEvent("message", {
        data: {type: "send", returnId: false, func, args: [{value}]}
    }))
    const lock = new Int8Array(new SharedArrayBuffer(1))
    send("sendShareLock", lock.buffer)
    const structure = (version: number, types: number[], count = types.length) => {
        const output = ByteArrayOutput.create()
        output.writeInt(Flags.ID)
        output.writeInt(version)
        output.writeInt(count)
        types.forEach((type, index) => {(index === 0 ? address : scalar).write(output); output.writeByte(type)})
        return output.toArrayBuffer()
    }
    const frame = (version: number, count: number, write: (output: ByteArrayOutput) => void) => {
        const output = ByteArrayOutput.create()
        output.writeBytes(new Int8Array(count))
        output.writeInt(version)
        output.writeInt(Flags.START)
        write(output)
        output.writeInt(Flags.END)
        send("sendUpdateData", output.toArrayBuffer())
        Atomics.store(lock, 0, Lock.READ)
    }
    return {receiver, send, lock, structure, frame}
}

describe("LiveStreamReceiver validated frames", () => {
    it("preserves the installed decoder after invalid structures", () => {
        const test = fixture()
        const received = vi.fn()
        test.receiver.subscribeFloat(address, received)
        test.send("sendUpdateStructure", test.structure(0, [PackageType.Float]))
        const truncated = test.structure(1, [PackageType.Float]).slice(0, 16)
        for (const invalid of [truncated, test.structure(1, [99]), test.structure(1, [], -1), test.structure(1, [], 0x7fffffff)]) {
            expect(() => test.send("sendUpdateStructure", invalid)).toThrow()
            test.frame(0, 1, output => output.writeFloat(12))
            test.receiver.dispatch()
            expect(received).toHaveBeenLastCalledWith(12)
        }
        test.send("sendUpdateStructure", test.structure(1, [PackageType.Float]))
        test.frame(1, 1, output => output.writeFloat(23))
        test.receiver.dispatch()
        expect(received).toHaveBeenLastCalledWith(23)
    })
    it.each([PackageType.ByteArray, PackageType.IntegerArray, PackageType.FloatArray])(
        "tracks array shape and exact framing for type %s", type => {
            const test = fixture()
            const arrays: Array<Int8Array | Int32Array | Float32Array> = []
            const values: number[][] = []
            const receive = (array: Int8Array | Int32Array | Float32Array) => {arrays.push(array); values.push(Array.from(array))}
            if (type === PackageType.ByteArray) {test.receiver.subscribeByteArray(address, receive)}
            if (type === PackageType.IntegerArray) {test.receiver.subscribeIntegers(address, receive)}
            if (type === PackageType.FloatArray) {test.receiver.subscribeFloats(address, receive)}
            const scalarSpy = vi.fn()
            test.receiver.subscribeInteger(scalar, scalarSpy)
            test.send("sendUpdateStructure", test.structure(0, [type, PackageType.Integer]))
            for (const length of [2, 4, 1, 1]) {
                test.frame(0, 2, output => {
                    output.writeInt(length)
                    for (let index = 0; index < length; index++) {
                        if (type === PackageType.ByteArray) {output.writeByte(index + 7)}
                        else if (type === PackageType.FloatArray) {output.writeFloat(index + 7)}
                        else {output.writeInt(index + 7)}
                    }
                    output.writeInt(456)
                })
                test.receiver.dispatch()
                expect(scalarSpy).toHaveBeenLastCalledWith(456)
            }
            expect(values).toEqual([[7, 8], [7, 8, 9, 10], [7], [7]])
            expect(arrays[0]).not.toBe(arrays[1])
            expect(arrays[1]).not.toBe(arrays[2])
            expect(arrays[2]).toBe(arrays[3])
        })
    it.each([-1, 0x7fffffff, 3])("rejects impossible payload length %s before dispatch", length => {
        const allocations: number[] = []
        vi.stubGlobal("Float32Array", new Proxy(Float32Array, {
            construct(target, args) {
                if (typeof args[0] === "number") {
                    allocations.push(args[0])
                    if (args[0] > 64) {throw new Error("Synthetic allocation guard")}
                }
                return Reflect.construct(target, args)
            }
        }))
        const test = fixture()
        test.send("sendUpdateStructure", test.structure(0, [PackageType.Float, PackageType.FloatArray]))
        const received = vi.fn()
        test.receiver.subscribeFloat(address, received)
        test.frame(0, 2, output => {output.writeFloat(3); output.writeInt(length)})
        expect(() => test.receiver.dispatch()).toThrow()
        expect(received).not.toHaveBeenCalled()
        expect(allocations).toEqual([])
        expect(Atomics.load(test.lock, 0)).toBe(Lock.WRITE)
        test.frame(0, 2, output => {output.writeFloat(7); output.writeInt(1); output.writeFloat(8)})
        expect(() => test.receiver.dispatch()).not.toThrow()
        expect(received).toHaveBeenLastCalledWith(7)
    })
    it("releases a throwing subscriber's frame and resets its cursor", () => {
        const test = fixture()
        test.send("sendUpdateStructure", test.structure(0, [PackageType.Float, PackageType.Integer]))
        const error = new Error("subscriber failed")
        test.receiver.subscribeFloat(address, vi.fn().mockImplementationOnce(() => {throw error}))
        const received = vi.fn()
        test.receiver.subscribeInteger(scalar, received)
        test.frame(0, 2, output => {output.writeFloat(3); output.writeInt(4)})
        expect(() => test.receiver.dispatch()).toThrow(error)
        expect(Atomics.load(test.lock, 0)).toBe(Lock.WRITE)
        expect(() => test.receiver.dispatch()).not.toThrow()
        test.frame(0, 2, output => {output.writeFloat(5); output.writeInt(6)})
        test.receiver.dispatch()
        expect(received).toHaveBeenCalledTimes(1)
        expect(received).toHaveBeenLastCalledWith(6)
    })
})
