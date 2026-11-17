import {describe, expect, it, vi} from "vitest"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {decodeSampleUpload} from "./SampleUpload"
const bytes = () => WavFile.encodeFloats(AudioData.create(48000, 2, 2))
const limits = {sourceBytes: 60, pcmBytes: 16, channels: 2, frames: 2}
const buffer = {length: 2, numberOfChannels: 2, sampleRate: 48000} as AudioBuffer
const run = (source = bytes(), size = source.byteLength, sampleRate = 48000) => {
    const file = {size, arrayBuffer: vi.fn(async () => source)} as unknown as File
    const context = {sampleRate, decodeAudioData: vi.fn(async () => buffer)}
    return {file, context, decode: () => decodeSampleUpload(file, context, () => true, limits)}
}
describe("upload allocation boundaries", () => {
    it("admits the inclusive byte/frame/channel/PCM limits", async () => {
        const {decode, context} = run()
        expect(await decode()).toBe(buffer)
        expect(context.decodeAudioData).toHaveBeenCalledOnce()
    })
    it("checks declared and actual source bytes independently", async () => {
        const declared = run(bytes(), 61)
        await expect(declared.decode()).rejects.toThrow(/byte/)
        expect(declared.file.arrayBuffer).not.toHaveBeenCalled()
        const acquired = run(new ArrayBuffer(61), 60)
        await expect(acquired.decode()).rejects.toThrow(/byte/)
        expect(acquired.context.decodeAudioData).not.toHaveBeenCalled()
    })
    it("refuses output amplification before decoding", async () => {
        const {decode, context} = run(bytes(), 60, 96000)
        await expect(decode()).rejects.toThrow(/PCM/)
        expect(context.decodeAudioData).not.toHaveBeenCalled()
    })
    it("refuses advertised truncated geometry without allocation", async () => {
        const source = bytes(); new DataView(source).setUint32(40, 1_000_000, true)
        const {decode, context} = run(source)
        await expect(decode()).rejects.toThrow(/Truncated/)
        expect(context.decodeAudioData).not.toHaveBeenCalled()
    })
    it("checks every decoded dimension again", async () => {
        for (const invalid of [{length: 3}, {numberOfChannels: 3}, {sampleRate: NaN}]) {
            const {decode, context} = run()
            context.decodeAudioData.mockResolvedValue({...buffer, ...invalid})
            await expect(decode()).rejects.toThrow(/PCM/)
        }
    })
})
