import {afterEach, describe, expect, it, vi} from "vitest"
import {ByteArrayInput, ByteArrayOutput} from "@opendaw/lib-std"
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
