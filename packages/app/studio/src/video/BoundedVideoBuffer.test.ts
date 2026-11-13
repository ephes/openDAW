import {expect, it} from "vitest"
import {BoundedVideoBuffer} from "./BoundedVideoBuffer"

it("admits just below/at the byte ceiling, rejects the next byte before retaining it", () => {
    const buffer = new BoundedVideoBuffer(16)
    buffer.write({position: 0, data: new Uint8Array(15).fill(1)})
    expect(buffer.finish().byteLength).toBe(15)
    buffer.write({position: 15, data: new Uint8Array([2])})
    expect(new Uint8Array(buffer.finish())[15]).toBe(2)
    expect(() => buffer.write({position: 16, data: new Uint8Array([3])})).toThrow(/shorter|stream/i)
    expect(() => buffer.finish()).toThrow()
})
it("applies seeked MP4 header rewrites without accumulating old copies", () => {
    const buffer = new BoundedVideoBuffer(16)
    buffer.write({position: 0, data: new Uint8Array([0, 0, 3, 4])})
    for (let i = 0; i < 100; i++) {buffer.write({position: 0, data: new Uint8Array([1, 2])})}
    expect(new Uint8Array(buffer.finish())).toEqual(new Uint8Array([1, 2, 3, 4]))
    buffer.clear()
    expect(() => buffer.write({position: 0, data: new Uint8Array(1)})).toThrow()
})
for (const position of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
    it(`rejects invalid/oversized output offset ${position}`, () => {
        const buffer = new BoundedVideoBuffer(16)
        expect(() => buffer.write({position, data: new Uint8Array(1)})).toThrow()
    })
}
