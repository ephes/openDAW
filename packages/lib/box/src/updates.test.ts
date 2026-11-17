import {afterEach, describe, expect, it, vi} from "vitest"
import {Arrays, ByteArrayInput, ByteArrayOutput, DataOutput, Option, UUID} from "@opendaw/lib-std"
import {Address} from "./address"
import {DeleteUpdate, NewUpdate, PointerUpdate, PrimitiveUpdate, Update, Updates} from "./updates"
import {PrimitiveType, ValueSerialization} from "./primitive"
import {graph, TestBox} from "./testing/fixtures"

const payload = (write: (output: DataOutput) => void) => {
    const output = ByteArrayOutput.create()
    write(output)
    return output.toArrayBuffer()
}
const block = (write: (output: DataOutput) => void) => payload(output => {output.writeInt(1); write(output)})
const address = Address.compose(UUID.generate(), 0)
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe("bounded update decoding", () => {
    it.each([-1, 0x7fffffff])("admits update count %s before allocating the result array", count => {
        const bytes = payload(output => output.writeInt(count))
        const allocate = vi.spyOn(Arrays, "create").mockImplementation(() => {throw new Error("unexpected array allocation")})
        expect(() => Updates.decode(new ByteArrayInput(bytes))).toThrow()
        expect(allocate).not.toHaveBeenCalled()
    })
    it.each(["new", "delete", "bytes"])("rejects excessive %s attachment length before allocation", type => {
        const bytes = block(output => {
            output.writeString(type === "bytes" ? "primitive" : type)
            if (type === "bytes") {
                address.write(output); output.writeString(PrimitiveType.Bytes)
            } else {
                UUID.toDataOutput(output, UUID.generate()); output.writeString("TestBox")
            }
            output.writeInt(0x7fffffff)
        })
        const allocations: number[] = []
        vi.stubGlobal("Int8Array", new Proxy(Int8Array, {construct(target, args) {
            if (typeof args[0] === "number" && args[0] > 1024) {
                allocations.push(args[0])
                throw new Error("unexpected attachment allocation")
            }
            return Reflect.construct(target, args)
        }}))
        expect(() => Updates.decode(new ByteArrayInput(bytes))).toThrow()
        expect(allocations).toEqual([])
    })
    it.each([
        block(output => output.writeString("future-update")),
        block(output => {output.writeString("primitive"); address.write(output); output.writeString("toString")}),
        block(output => {output.writeString("primitive"); address.write(output); output.writeString("future-value")}),
        block(output => {output.writeString("new"); UUID.toDataOutput(output, UUID.generate()); output.writeString("TestBox"); output.writeInt(3); output.writeByte(0)}),
        payload(output => {output.writeInt(0); output.writeByte(99)}),
        new ArrayBuffer(0)
    ])("refuses unknown tags, truncation and residue", bytes => {
        expect(() => Updates.decode(new ByteArrayInput(bytes))).toThrow()
    })
    it("requires a bounded input before reading its count", () => {
        const input = new ByteArrayInput(payload(output => output.writeInt(0)))
        const unbounded = new Proxy(input, {get(target, property) {
            if (property === "remaining") {return undefined}
            const value = Reflect.get(target, property)
            return typeof value === "function" ? value.bind(target) : value
        }})
        expect(() => Updates.decode(unbounded)).toThrow()
        expect(input.position).toBe(0)
    })
    it("round trips all update and primitive kinds, replay and inverse", () => {
        const source = graph()
        source.beginTransaction()
        const first = TestBox.create(source), second = TestBox.create(source)
        source.endTransaction()
        const updates: Update[] = [
            new PrimitiveUpdate(first.getField(0).address, ValueSerialization.boolean, false, true),
            new PrimitiveUpdate(first.getField(1).address, ValueSerialization.string, "", "synthetic"),
            new PrimitiveUpdate(first.getField(3).address, ValueSerialization.float32, 0, 0.5),
            new PointerUpdate(first.getField(2).address, Option.None, Option.wrap(second.address))
        ]
        const before = source.toArrayBuffer()
        const encoded = payload(output => {output.writeInt(updates.length); updates.forEach(update => update.write(output))})
        const decoded = Updates.decode(new ByteArrayInput(encoded))
        source.beginTransaction(); decoded.forEach(update => update.forward(source)); source.endTransaction()
        expect(first.getField(1).getValue()).toBe("synthetic")
        source.beginTransaction(); decoded.toReversed().forEach(update => update.inverse(source)); source.endTransaction()
        expect(source.toArrayBuffer()).toEqual(before)
        const variants: Update[] = [new NewUpdate(second.address.uuid, second.name, second.toArrayBuffer()),
            new DeleteUpdate(second.address.uuid, second.name, second.toArrayBuffer()),
            new PrimitiveUpdate(address, ValueSerialization.int32, 0, -123),
            new PrimitiveUpdate(address, ValueSerialization.bytes, new Int8Array([1]), new Int8Array([2, 3]))]
        const bytes = payload(output => {output.writeInt(variants.length); variants.forEach(update => update.write(output))})
        const reencoded = payload(output => {
            const result = Updates.decode(new ByteArrayInput(bytes))
            output.writeInt(result.length); result.forEach(update => update.write(output))
        })
        expect(reencoded).toEqual(bytes)
    })
})
