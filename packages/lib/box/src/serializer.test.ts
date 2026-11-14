import {afterEach, describe, expect, it, vi} from "vitest"
import {ByteArrayInput, ByteArrayOutput, ByteCounter, Option} from "@opendaw/lib-std"
import {Serializer} from "./serializer"
import {fields, graph, project, TestBox} from "./testing/fixtures"

const flag = new Int8Array([1]).buffer
const text = ByteArrayOutput.create()
text.writeString("retained")
const frame = (count: number, length?: number, payload = new ArrayBuffer(0)) => {
    const out = ByteArrayOutput.create()
    out.writeInt(0x464c4453)
    out.writeShort(count)
    if (length !== undefined) {
        out.writeShort(0)
        out.writeInt(length)
        out.writeBytes(new Int8Array(payload))
    }
    return out.toArrayBuffer()
}

afterEach(() => vi.restoreAllMocks())
describe("binary field compatibility", () => {
    it.each([0, 2] as const)("rejects duplicate key %s in either order before decoding fields", key => {
        const source = graph()
        source.beginTransaction()
        const box = TestBox.create(source)
        const other = TestBox.create(source)
        const first = ByteArrayOutput.create()
        box.getField(key).write(first)
        box.getField(0).setValue(true)
        box.getField(2).targetAddress = Option.wrap(other.address)
        const second = ByteArrayOutput.create()
        box.getField(key).write(second)
        source.endTransaction()
        for (const payloads of [[first, second], [second, first]]) {
            const read = vi.spyOn(box.getField(key), "read")
            const bytes = fields(payloads.map(payload => [key, payload.toArrayBuffer()]))
            expect(() => Serializer.readFields(new ByteArrayInput(bytes), box.record())).toThrow(Serializer.DecodeError)
            expect(read).not.toHaveBeenCalled()
            const target = graph()
            expect(() => target.fromArrayBuffer(project(bytes))).toThrow(Serializer.DecodeError)
            expect(target.boxes()).toHaveLength(0)
            expect(target.inTransaction()).toBe(false)
            target.fromArrayBuffer(project(fields([[0, flag]])))
            expect(target.boxes()).toHaveLength(1)
        }
    })

    it.each([new Int8Array([1, 99]).buffer, new ArrayBuffer(0)])("refuses primitive residue or truncation", payload => {
        const target = graph()
        expect(() => target.fromArrayBuffer(project(fields([[0, payload]])))).toThrow(Serializer.DecodeError)
        expect(target.boxes()).toHaveLength(0)
        expect(target.inTransaction()).toBe(false)
        target.fromArrayBuffer(project(fields([[0, flag]])))
        expect(target.boxes()).toHaveLength(1)
    })

    it("refuses excessive writer counts and noncanonical or unrepresentable keys before emitting", () => {
        const source = graph()
        source.beginTransaction()
        const box = TestBox.create(source)
        source.endTransaction()
        const field = box.getField(0)
        const tooMany = Object.fromEntries(Array.from({length: 32768}, (_, index) => [index, field]))
        for (const record of [tooMany, {32768: field}, {"-32769": field}, {"01": field}, {"1junk": field}]) {
            const output = ByteArrayOutput.create()
            expect(() => Serializer.writeFields(output, record)).toThrow()
            expect(output.position).toBe(0)
        }
    })

    it("admits signed key boundaries and refuses an oversized save before publication", () => {
        const source = graph()
        source.beginTransaction()
        const box = TestBox.create(source)
        source.endTransaction()
        const field = box.getField(0)
        const boundary = ByteArrayOutput.create()
        Serializer.writeFields(boundary, {"-32768": field, 32767: field})
        Serializer.readFields(new ByteArrayInput(boundary.toArrayBuffer()), {})
        const generation = source.toArrayBuffer()
        let published = generation
        const output = ByteArrayOutput.create()
        const chunk = new Int8Array(65536)
        // A counting writer models a large synthetic payload without allocating audio.
        vi.spyOn(field, "write").mockImplementation(target => {
            if (!(target instanceof ByteCounter)) {throw new Error("oversized writer reached allocation")}
            for (let index = 0; index < 1024; index++) {target.writeBytes(chunk)}
            target.writeByte(0)
        })
        expect(() => Serializer.writeFields(output, {0: field})).toThrow(/64 MiB/)
        expect(output.position).toBe(0)
        expect(() => {published = source.toArrayBuffer()}).toThrow(/64 MiB/)
        expect(published).toBe(generation)
        vi.restoreAllMocks()
        expect(source.toArrayBuffer()).toEqual(generation)
    })

    it("writes exactly the maximum count and payload size in reloadable frames", () => {
        const source = graph()
        source.beginTransaction()
        const box = TestBox.create(source)
        source.endTransaction()
        const field = box.getField(0)
        const maximumCount = Object.fromEntries(Array.from({length: 32767}, (_, index) => [index, field]))
        const countOutput = ByteArrayOutput.create()
        Serializer.writeFields(countOutput, maximumCount)
        const countInput = new ByteArrayInput(countOutput.toArrayBuffer())
        Serializer.readFields(countInput, {})
        expect(countInput.remaining()).toBe(0)
        const chunk = new Int8Array(65536)
        vi.spyOn(field, "write").mockImplementation(output => {
            for (let index = 0; index < 1024; index++) {output.writeBytes(chunk)}
        })
        const output = ByteArrayOutput.create()
        Serializer.writeFields(output, {0: field})
        const input = new ByteArrayInput(output.toArrayBuffer())
        Serializer.readFields(input, {})
        expect(output.position).toBe(12 + Serializer.MAX_FIELD_BYTES)
        expect(input.remaining()).toBe(0)
    })
    it("skips empty and opaque unknown frames before and between supported fields in a real import", () => {
        const target = graph()
        target.fromArrayBuffer(project(fields([[123, new ArrayBuffer(0)], [0, flag],
            [124, new Int8Array([99, 0, 1, 2, 3]).buffer], [1, text.toArrayBuffer()]])))
        const box = target.boxes()[0] as TestBox
        expect(box.getField(0).getValue()).toBe(true)
        expect(box.getField(1).getValue()).toBe("retained")
        const reloaded = graph()
        reloaded.fromArrayBuffer(target.toArrayBuffer())
        expect(reloaded.checksum()).toEqual(target.checksum())
    })

    it.each([
        ["negative count", frame(-1)],
        ["unavailable field headers", frame(32767)],
        ["short header", new ArrayBuffer(3)],
        ["short field header", frame(1).slice(0, 6)],
        ["negative length", frame(1, -1)],
        ["over-limit length", frame(1, 64 * 1024 * 1024 + 1)],
        ["truncated payload", frame(1, 1024)]
    ])("refuses %s before allocating field payloads or publishing boxes", (_name, bytes) => {
        const target = graph()
        const read = vi.spyOn(ByteArrayInput.prototype, "readBytes")
        expect(() => Serializer.readFields(new ByteArrayInput(bytes), {})).toThrow()
        expect(read).not.toHaveBeenCalled()
        expect(() => target.fromArrayBuffer(project(bytes))).toThrow()
        expect(target.boxes()).toHaveLength(0)
        expect(target.inTransaction()).toBe(false)
    })

    it("admits exactly 64 MiB opaque frames without a payload copy", () => {
        const bytes = new ArrayBuffer(6 + 6 + 64 * 1024 * 1024)
        const out = ByteArrayOutput.use(bytes)
        out.writeInt(0x464c4453)
        out.writeShort(1)
        out.writeShort(99)
        out.writeInt(64 * 1024 * 1024)
        const input = new ByteArrayInput(bytes)
        const read = vi.spyOn(input, "readBytes")
        Serializer.readFields(input, {})
        expect(input.remaining()).toBe(0)
        expect(read).not.toHaveBeenCalled()
    })

    it("propagates a bounded supported-field error after mutation and rolls back the imported graph", () => {
        const prior = graph()
        prior.fromArrayBuffer(project(fields([[1, text.toArrayBuffer()]])))
        const checksum = prior.checksum()
        const target = graph()
        const original = TestBox.prototype.read
        vi.spyOn(TestBox.prototype, "read").mockImplementation(function(this: TestBox, input) {
            const field = this.getField(1)
            const read = field.read.bind(field)
            field.read = data => {read(data); throw new Error("private corrupt payload")}
            original.call(this, input)
        })
        expect(() => target.fromArrayBuffer(project(fields([[0, flag]]), fields([[1, text.toArrayBuffer()]]))))
            .toThrow(/^Could not decode field 1$/)
        expect(target.boxes()).toHaveLength(0)
        expect(target.inTransaction()).toBe(false)
        expect(prior.checksum()).toEqual(checksum)
        vi.restoreAllMocks()
        target.fromArrayBuffer(project(fields([[0, flag]])))
        expect((target.boxes()[0] as TestBox).getField(0).getValue()).toBe(true)
    })
})
