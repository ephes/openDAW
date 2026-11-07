import {expect, it, vi} from "vitest"
import {MIDISender} from "./MIDISender"
function fixture(size = 4) {
    const sab = new SharedArrayBuffer(8 + size * 8)
    const indices = new Uint32Array(sab, 0, 2), ring = new Uint32Array(sab, 8)
    const messages: unknown[] = []
    const sender = new MIDISender({postMessage: (message: unknown) => {
        messages.push(message)
        if (message === null) expect(Atomics.load(indices, 0)).not.toBe(Atomics.load(indices, 1))
    }} as MessagePort, sab)
    const read = () => {
        const cursor = Atomics.load(indices, 1), word = ring[cursor * 2]
        const length = word >>> 30, device = (word >>> 24) & 63
        const data = [(word >>> 16) & 255, (word >>> 8) & 255, word & 255].slice(0, length)
        const time = ring[cursor * 2 + 1]
        Atomics.store(indices, 1, (cursor + 1) % size)
        return {length, device, data, time}
    }
    return {sender, indices, ring, messages, read}
}
it("publishes complete one/two/three byte messages, wraps and preserves a full ring", () => {
    const f = fixture()
    const data = [[0xfa], [0xc0, 12], [0x90, 60, 100]]
    data.forEach((d, i) => expect(f.sender.send("a", new Uint8Array(d), i + 2.9)).toBe(true))
    expect(f.messages).toEqual([{registerDevice: "a", id: 0}, null, null, null])
    const ring = f.ring.slice(), cursor = f.indices[0]
    expect(f.sender.send("a", new Uint8Array([0xfc]), 99)).toBe(false)
    expect(f.ring).toEqual(ring); expect(f.indices[0]).toBe(cursor)
    expect(f.read()).toEqual({length: 1, device: 0, data: data[0], time: 2})
    expect(f.sender.send("a", new Uint8Array([0xfc]), 23)).toBe(true)
    expect(f.indices[0]).toBe(0)
    expect(f.read()).toEqual({length: 2, device: 0, data: data[1], time: 3})
    expect(f.read()).toEqual({length: 3, device: 0, data: data[2], time: 4})
    expect(f.read()).toEqual({length: 1, device: 0, data: [0xfc], time: 23})
})
it("supports exactly 64 device ids", () => {
    const f = fixture(128), error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
        for (let i = 0; i < 64; i++) {
            expect(f.sender.send(`device-${i}`, new Uint8Array([0xf8]), i)).toBe(true)
            expect(f.read().device).toBe(i)
        }
        expect(f.sender.send("overflow", new Uint8Array([0xf8]), 0)).toBe(false)
        expect(f.messages.filter(m => m !== null)).toHaveLength(64)
    } finally {error.mockRestore()}
})
