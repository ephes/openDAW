import {WritableStream as TestWritableStream} from "node:stream/web"
import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {BufferVideoExporter, StreamVideoExporter} from "./WebCodecsVideoExporter"

const m = vi.hoisted(() => ({
    canvas: vi.fn(), draw: vi.fn(), video: vi.fn(), audio: vi.fn(), start: vi.fn(), finalize: vi.fn(),
    cancel: vi.fn(), videoClose: vi.fn(), audioClose: vi.fn(), sample: vi.fn(), sampleClose: vi.fn(),
    data: vi.fn(), dataClose: vi.fn(), save: vi.fn(), videoTrack: vi.fn(), audioTrack: vi.fn(), videoConstruct: vi.fn(), audioConstruct: vi.fn()
}))
vi.mock("@opendaw/lib-dom", () => ({Files: {save: m.save}}))
vi.mock("mediabunny", () => ({
    Output: class {
        addVideoTrack = m.videoTrack; addAudioTrack = m.audioTrack
        start = m.start; finalize = m.finalize; cancel = m.cancel
    },
    Mp4OutputFormat: class {}, BufferTarget: class {buffer = new ArrayBuffer(4)}, StreamTarget: class {},
    CanvasSource: class {constructor() {m.videoConstruct()} add = m.video; close = m.videoClose},
    AudioSampleSource: class {constructor() {m.audioConstruct()} add = m.audio; close = m.audioClose},
    AudioSample: class {constructor(data: unknown) {m.sample(data)} close = m.sampleClose}
}))
const config = {width: 1280, height: 720, frameRate: 60, sampleRate: 48000, numberOfChannels: 2}
const canvas = {} as OffscreenCanvas
const audio = () => [new Float32Array([1, 2]), new Float32Array([3, 4])]
beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("WritableStream", TestWritableStream)
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
    const exporter = await StreamVideoExporter.create(config, new WritableStream())
    await exporter.addFrame(canvas, audio(), 1)
    expect(m.data.mock.calls[0][0].data).toEqual(new Float32Array([1, 2, 3, 4]))
    await expect(exporter.addFrame(canvas, audio(), 0.5)).rejects.toThrow()
    expect(m.video).toHaveBeenCalledTimes(1)
    expect(m.audio).toHaveBeenCalledTimes(1)
})

for (const sampleRate of [44100, 48000]) {
    for (const frameRate of [30, 60, 120]) {
        it(`keeps quantum audio contiguous at ${sampleRate} Hz / ${frameRate} fps`, async () => {
            const exporter = await BufferVideoExporter.create({...config, sampleRate, frameRate})
            let submitted = 0
            for (let frame = 0; frame < 30; frame++) {
                const target = Math.round((frame + 1) * sampleRate / frameRate)
                const count = Math.ceil((target - submitted) / 128) * 128
                await exporter.addFrame(canvas, [new Float32Array(count), new Float32Array(count)], frame / frameRate)
                const data = m.data.mock.calls[frame][0]
                expect(data.timestamp).toBe(Math.round(submitted / sampleRate * 1_000_000))
                expect(data.numberOfFrames).toBe(count)
                submitted += count
            }
            expect(submitted).toBe(Math.ceil(Math.round(30 * sampleRate / frameRate) / 128) * 128)
            expect(m.video.mock.calls.map(call => call[0])).toEqual(Array.from({length: 30}, (_, i) => i / frameRate))
        })
    }
}

for (const stage of ["videoConstruct", "videoTrack", "audioConstruct", "audioTrack", "start"] as const) {
    it(`rolls back encoder construction at ${stage}`, async () => {
        const failure = new Error(stage)
        m[stage].mockImplementationOnce(() => {throw failure})
        await expect(BufferVideoExporter.create(config)).rejects.toBe(failure)
        expect(m.cancel).toHaveBeenCalledTimes(1)
        if (stage !== "videoConstruct") {expect(m.videoClose).toHaveBeenCalledTimes(1)}
        if (["audioTrack", "start"].includes(stage)) {expect(m.audioClose).toHaveBeenCalledTimes(1)}
    })
}
it("rolls back when codec probing throws synchronously", async () => {
    const failure = new Error("codec probe")
    vi.stubGlobal("AudioEncoder", {isConfigSupported: () => {throw failure}})
    await expect(BufferVideoExporter.create(config)).rejects.toBe(failure)
    expect(m.cancel).toHaveBeenCalledTimes(1)
    expect(m.videoClose).toHaveBeenCalledTimes(1)
})
it("transfers a successful encoder without early cancellation", async () => {
    await BufferVideoExporter.create(config)
    expect(m.cancel).not.toHaveBeenCalled()
    expect(m.videoClose).not.toHaveBeenCalled()
    expect(m.audioClose).not.toHaveBeenCalled()
})
for (const stage of ["sample", "audio"] as const) {
    it(`closes native audio owners when ${stage} fails`, async () => {
        const exporter = await BufferVideoExporter.create(config)
        const failure = new Error(stage)
        m[stage].mockImplementationOnce(() => {throw failure})
        await expect(exporter.addFrame(canvas, audio(), 0)).rejects.toBe(failure)
        expect(m.dataClose).toHaveBeenCalledTimes(1)
        expect(m.sampleClose).toHaveBeenCalledTimes(stage === "sample" ? 0 : 1)
    })
}

for (const streaming of [false, true]) {
    it(`cancels the muxer once and rejects later submissions (stream=${streaming})`, async () => {
        const abort = vi.fn()
        const exporter = streaming
            ? await StreamVideoExporter.create(config, new WritableStream({abort}))
            : await BufferVideoExporter.create(config)
        await exporter.abort()
        await exporter.abort()
        exporter.terminate()
        expect(m.cancel).toHaveBeenCalledTimes(1)
        await expect(exporter.addFrame(canvas, audio(), 0)).rejects.toThrow()
        await expect(exporter.finalize()).rejects.toThrow()
        expect(m.save).not.toHaveBeenCalled()
        expect(abort).toHaveBeenCalledTimes(streaming ? 1 : 0)
    })
    it(`cannot publish a finalization retired by abort (stream=${streaming})`, async () => {
        const finish = Promise.withResolvers<void>()
        m.finalize.mockReturnValue(finish.promise)
        const close = vi.fn(); const abort = vi.fn()
        const exporter = streaming
            ? await StreamVideoExporter.create(config, new WritableStream({close, abort}))
            : await BufferVideoExporter.create(config)
        const pending = exporter.finalize()
        const result = expect(pending).rejects.toThrow()
        await exporter.abort()
        finish.resolve()
        await result
        expect(m.cancel).toHaveBeenCalledTimes(1)
        expect(m.save).not.toHaveBeenCalled()
        expect(close).not.toHaveBeenCalled()
    })
}
