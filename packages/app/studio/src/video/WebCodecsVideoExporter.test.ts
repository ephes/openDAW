import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {BufferVideoExporter, StreamVideoExporter} from "./WebCodecsVideoExporter"

const m = vi.hoisted(() => ({
    canvas: vi.fn(), draw: vi.fn(), video: vi.fn(), audio: vi.fn(), start: vi.fn(), finalize: vi.fn(),
    cancel: vi.fn(), videoClose: vi.fn(), audioClose: vi.fn(), sample: vi.fn(), sampleClose: vi.fn(),
    data: vi.fn(), dataClose: vi.fn(), save: vi.fn(), videoTrack: vi.fn(), audioTrack: vi.fn()
}))
vi.mock("@opendaw/lib-dom", () => ({Files: {save: m.save}}))
vi.mock("mediabunny", () => ({
    Output: class {
        addVideoTrack = m.videoTrack; addAudioTrack = m.audioTrack
        start = m.start; finalize = m.finalize; cancel = m.cancel
    },
    Mp4OutputFormat: class {}, BufferTarget: class {buffer = new ArrayBuffer(4)}, StreamTarget: class {},
    CanvasSource: class {add = m.video; close = m.videoClose},
    AudioSampleSource: class {add = m.audio; close = m.audioClose},
    AudioSample: class {constructor(data: unknown) {m.sample(data)} close = m.sampleClose}
}))
const config = {width: 1280, height: 720, frameRate: 60, sampleRate: 48000, numberOfChannels: 2}
const canvas = {} as OffscreenCanvas
const audio = () => [new Float32Array([1, 2]), new Float32Array([3, 4])]
beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("OffscreenCanvas", class {
        constructor(...args: unknown[]) {m.canvas(...args)}
        getContext() {return {drawImage: m.draw}}
    })
    vi.stubGlobal("AudioEncoder", {isConfigSupported: vi.fn(async () => ({supported: true}))})
    vi.stubGlobal("AudioData", class {
        constructor(data: unknown) {m.data(data)}
        close = m.dataClose
    })
})
afterEach(() => {vi.unstubAllGlobals()})

for (const invalid of [
    {width: 0}, {width: -2}, {width: 1.5}, {width: 100000}, {height: NaN}, {height: Infinity},
    {width: 4096, height: 4096}, {frameRate: 0}, {frameRate: 59}, {sampleRate: NaN},
    {numberOfChannels: 0}, {numberOfChannels: 100000}, {videoBitrate: Infinity}
]) {
    it(`rejects config ${JSON.stringify(invalid)} before canvas allocation`, async () => {
        await expect(BufferVideoExporter.create({...config, ...invalid})).rejects.toThrow()
        expect(m.canvas).not.toHaveBeenCalled()
        expect(m.start).not.toHaveBeenCalled()
    })
}
for (const invalid of [[], [new Float32Array(2)], [new Float32Array(2), new Float32Array(3)],
    [new Float32Array(2), new Float32Array(1)], [new Float32Array(1000000), new Float32Array(1000000)]]) {
    it(`refuses malformed audio lengths ${invalid.map(x => x.length)} atomically`, async () => {
        const exporter = await BufferVideoExporter.create(config)
        await expect(exporter.addFrame(canvas, invalid, 0)).rejects.toThrow()
        expect(m.video).not.toHaveBeenCalled()
        expect(m.audio).not.toHaveBeenCalled()
    })
}
for (const timestamp of [NaN, Infinity, -1]) {
    it(`refuses timestamp ${timestamp} before submission`, async () => {
        const exporter = await BufferVideoExporter.create(config)
        await expect(exporter.addFrame(canvas, audio(), timestamp)).rejects.toThrow()
        expect(m.video).not.toHaveBeenCalled()
        expect(m.audio).not.toHaveBeenCalled()
    })
}
it("refuses timestamp regression and preserves planar channel identity", async () => {
    const exporter = await StreamVideoExporter.create(config, {} as WritableStream)
    await exporter.addFrame(canvas, audio(), 1)
    expect(m.data.mock.calls[0][0].data).toEqual(new Float32Array([1, 2, 3, 4]))
    await expect(exporter.addFrame(canvas, audio(), 0.5)).rejects.toThrow()
    expect(m.video).toHaveBeenCalledTimes(1)
    expect(m.audio).toHaveBeenCalledTimes(1)
})
