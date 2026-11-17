import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {Files} from "@opendaw/lib-dom"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {PageContext} from "@opendaw/lib-jsx"
import type {StudioService} from "@/service/StudioService"
import {SampleUploadPage} from "./SampleUploadPage"
vi.mock("@opendaw/lib-dom", async original => {
    const module = await original<typeof import("@opendaw/lib-dom")>()
    return {...module, Html: {...module.Html, adoptStyleSheet: () => "sample-upload-test"}}
})
const mocks = vi.hoisted(() => ({upload: vi.fn(), info: vi.fn()}))
vi.mock("@opendaw/studio-core", () => ({FilePickerAcceptTypes: {WavFiles: {}}, OpenSampleAPI: {get: () => ({upload: mocks.upload})}}))
vi.mock("@/ui/components/dialogs.tsx", () => ({Dialogs: {info: mocks.info}}))
const flush = async () => {for (let i = 0; i < 20; i++) {await Promise.resolve()}}
const wav = () => WavFile.encodeFloats(AudioData.create(48000, 2, 1))
const decoded = () => ({sampleRate: 48000, length: 2, numberOfChannels: 1, duration: 2 / 48000,
    getChannelData: () => new Float32Array(2)}) as unknown as AudioBuffer
const file = (bytes = wav(), size = bytes.byteLength) => ({name: "synthetic.wav", size, arrayBuffer: vi.fn(async () => bytes)}) as unknown as File
const setup = () => {
    const lifecycle = new Terminator(), decode = vi.fn(async () => decoded())
    const service = {audioContext: {sampleRate: 48000, decodeAudioData: decode}} as unknown as StudioService
    const page = SampleUploadPage({service, lifecycle, path: "/upload", error: ""} as PageContext<StudioService>) as HTMLElement
    const button = page.querySelector("button")!
    return {lifecycle, decode, button}
}
beforeEach(() => {mocks.upload.mockReset().mockResolvedValue(undefined); mocks.info.mockReset().mockResolvedValue(undefined)})
afterEach(() => vi.restoreAllMocks())
describe("sample upload admission", () => {
    it("rejects declared oversize before reading", async () => {
        const selected = file(wav(), 64 * 1024 * 1024 + 1)
        vi.spyOn(Files, "open").mockResolvedValue([selected])
        const {button, decode, lifecycle} = setup(); button.click(); await flush()
        expect(selected.arrayBuffer).not.toHaveBeenCalled()
        expect(decode).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
        lifecycle.terminate()
    })
    it("rejects unsupported or excessive WAV geometry before decoding", async () => {
        const bytes = wav(); new DataView(bytes).setUint16(22, 65535, true)
        vi.spyOn(Files, "open").mockResolvedValue([file(bytes)])
        const {button, decode, lifecycle} = setup(); button.click(); await flush()
        expect(decode).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
        lifecycle.terminate()
    })
    it("rejects excessive decoded geometry before encoding", async () => {
        vi.spyOn(Files, "open").mockResolvedValue([file()])
        const {button, decode, lifecycle} = setup()
        const data = decoded(); Object.defineProperty(data, "length", {value: 64 * 1024 * 1024})
        decode.mockResolvedValue(data)
        const encode = vi.spyOn(WavFile, "encodeFloats")
        button.click(); await flush()
        expect(encode).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
        lifecycle.terminate()
    })
})
describe("sample upload attempt lifetime", () => {
    it("holds one attempt through picker and remote completion", async () => {
        const picker = Promise.withResolvers<File[]>(), upload = Promise.withResolvers<void>()
        const open = vi.spyOn(Files, "open").mockReturnValue(picker.promise)
        mocks.upload.mockReturnValue(upload.promise)
        const {button, lifecycle} = setup()
        button.click(); button.click(); expect(open).toHaveBeenCalledOnce()
        picker.resolve([file()]); await flush()
        expect(mocks.upload).toHaveBeenCalledOnce()
        button.click(); expect(open).toHaveBeenCalledOnce()
        upload.resolve(); await flush(); button.click(); expect(open).toHaveBeenCalledTimes(2)
        lifecycle.terminate(); await flush()
    })
    it.each(["picker", "read", "decode"])("retirement fences pending %s", async boundary => {
        const picker = Promise.withResolvers<File[]>(), read = Promise.withResolvers<ArrayBuffer>(), decodeResult = Promise.withResolvers<AudioBuffer>()
        const selected = file()
        vi.spyOn(Files, "open").mockReturnValue(boundary === "picker" ? picker.promise : Promise.resolve([selected]))
        if (boundary === "read") {vi.mocked(selected.arrayBuffer).mockReturnValue(read.promise)}
        const {button, decode, lifecycle} = setup()
        if (boundary === "decode") {decode.mockReturnValue(decodeResult.promise)}
        button.click(); await flush(); lifecycle.terminate()
        picker.resolve([selected]); read.resolve(wav()); decodeResult.resolve(decoded()); await flush()
        expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.info).not.toHaveBeenCalled()
    })
    it("aborts an owned upload and observes late rejection", async () => {
        vi.spyOn(Files, "open").mockResolvedValue([file()])
        const upload = Promise.withResolvers<void>(); mocks.upload.mockReturnValue(upload.promise)
        const {button, lifecycle} = setup(); button.click(); await flush()
        const signal = mocks.upload.mock.calls[0]?.[2] as AbortSignal
        lifecycle.terminate(); upload.reject(new Error("late failure")); await flush()
        expect(signal?.aborted).toBe(true); expect(mocks.info).not.toHaveBeenCalled()
    })
})
