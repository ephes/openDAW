import {afterEach, expect, it, vi} from "vitest"
import {RingBuffer} from "./RingBuffer"

const config = (): RingBuffer.Config => ({sab: new SharedArrayBuffer(12 + 2 * 4), numChunks: 2, numberOfChannels: 1, bufferSize: 1})
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals()})
it("reports overflow instead of disguising unread blocks as empty", () => {
    vi.stubGlobal("document", {})
    vi.useFakeTimers()
    const c = config(), writer = RingBuffer.writer(c)
    writer.write([Float32Array.of(1)])
    writer.write([Float32Array.of(2)])
    const append = vi.fn(), fault = vi.fn()
    const reader = RingBuffer.reader(c, append, fault)
    expect(fault).toHaveBeenCalledWith(1)
    expect(append).not.toHaveBeenCalled()
    reader.stop()
})
it("delivers every admitted block once across wraparound", () => {
    vi.stubGlobal("document", {})
    vi.useFakeTimers()
    const c = config(), writer = RingBuffer.writer(c)
    const seen: number[] = []
    const reader = RingBuffer.reader(c, planes => seen.push(planes[0][0]))
    for (let i = 1; i <= 8; i++) {
        writer.write([Float32Array.of(i)])
        vi.advanceTimersByTime(1)
    }
    reader.stop()
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})
