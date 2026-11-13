import {WritableStream as TestWritableStream} from "node:stream/web"
import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {BufferVideoExporter, StreamVideoExporter} from "./WebCodecsVideoExporter"

const save = vi.hoisted(() => vi.fn())
vi.mock("@opendaw/lib-dom", () => ({Files: {save}}))
const config = {width: 1280, height: 720, frameRate: 30, sampleRate: 48000, numberOfChannels: 2, durationSeconds: 1}
beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("WritableStream", TestWritableStream)
    vi.stubGlobal("AudioEncoder", {isConfigSupported: async () => ({supported: true})})
    vi.stubGlobal("OffscreenCanvas", class {getContext() {return {drawImage() {}}}})
})
afterEach(() => {vi.unstubAllGlobals()})
it("discards a real mediabunny streaming target on cancel without committing the file", async () => {
    const close = vi.fn(); const abort = vi.fn()
    const writable = new WritableStream({close, abort})
    const exporter = await StreamVideoExporter.create(config, writable)
    await exporter.abort()
    await exporter.abort()
    expect(abort).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    expect(writable.locked).toBe(false)
    await expect(exporter.finalize()).rejects.toThrow()
})
it("finalizes a real mediabunny bounded MP4 and saves only a complete buffer", async () => {
    const exporter = await BufferVideoExporter.create(config)
    await exporter.finalize()
    expect(save).toHaveBeenCalledTimes(1)
    const bytes = new Uint8Array(save.mock.calls[0][0])
    expect(bytes.length).toBeGreaterThan(16)
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe("ftyp")
    await exporter.abort()
    expect(save).toHaveBeenCalledTimes(1)
})
it("matches real AudioSample transfer and precise timestamp semantics", async () => {
    const {AudioSample} = await import("mediabunny")
    const close = vi.fn()
    class NativeData {
        format: string | null = "f32-planar"
        sampleRate = 48000
        numberOfFrames = 896
        numberOfChannels = 2
        timestamp = 18667
        close() {close(); this.format = null}
    }
    vi.stubGlobal("AudioData", NativeData)
    const data = new AudioData({} as AudioDataInit)
    const sample = new AudioSample(data)
    sample.setTimestamp(896 / 48000)
    expect(sample.timestamp).toBe(896 / 48000)
    sample.close()
    expect(data.format).toBeNull()
    expect(close).toHaveBeenCalledTimes(1)
})
