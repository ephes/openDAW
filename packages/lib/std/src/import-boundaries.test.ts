import {expect, it} from "vitest"
import {UUID} from "./uuid"
import {ByteArrayInput, ByteArrayOutput} from "./data"
for (const text of ["z".repeat(32), "0g".repeat(16), "0000000000000000000000000000000-0", "-" + "0".repeat(32)]) {
    it(`rejects malformed UUID ${text}`, () => expect(() => UUID.parse(text)).toThrow())
}
it("retains compact and canonical uppercase/lowercase UUID bytes", () => {
    const compact = "00112233445566778899aabbccddeeff"
    expect(UUID.parse(compact.toUpperCase())).toEqual(UUID.parse("00112233-4455-6677-8899-aabbccddeeff"))
})
for (const length of [-1, 0x7fffffff, 3]) {
    it(`rejects invalid declared string length ${length} before character reads`, () => {
        const out = ByteArrayOutput.create()
        out.writeInt(length); out.writeShort(65)
        const input = new ByteArrayInput(out.toArrayBuffer())
        expect(() => input.readString()).toThrow()
        expect(input.position).toBe(4)
    })
}
it("reads empty and exact-boundary UTF-16 strings", () => {
    const out = ByteArrayOutput.create(); out.writeString(""); out.writeString("A😀")
    const input = new ByteArrayInput(out.toArrayBuffer())
    expect(input.readString()).toBe(""); expect(input.readString()).toBe("A😀"); expect(input.remaining()).toBe(0)
})
