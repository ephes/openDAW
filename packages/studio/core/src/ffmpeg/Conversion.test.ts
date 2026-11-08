// @vitest-environment node
import {describe, expect, it, vi} from "vitest"
import type {FFmpeg} from "@ffmpeg/ffmpeg"
import {FFmpegWorker} from "./FFmpegWorker"

const setup = () => {
    let progress: (event: {progress: number}) => void = () => {}
    let input = new Uint8Array()
    const ffmpeg = {
        loaded: true,
        on: vi.fn((type, handler) => { if (type === "progress") progress = handler }),
        writeFile: vi.fn(async (_path, data) => { input = data }),
        exec: vi.fn(async () => { progress({progress: input[0] / 10}); return 0 }),
        readFile: vi.fn(async () => input.slice()),
        deleteFile: vi.fn(async () => {})
    }
    const worker = new FFmpegWorker(ffmpeg as unknown as FFmpeg)
    return {worker, ffmpeg}
}

describe("conversion ownership", () => {
    it.each(["mp3", "flac"] as const)("queues MP3 and %s inputs and progress through cleanup", async format => {
        const {worker, ffmpeg} = setup()
        const gate = Promise.withResolvers<void>()
        ffmpeg.exec.mockImplementationOnce(async () => { await gate.promise; return 0 })
        const firstProgress = vi.fn(), secondProgress = vi.fn()
        const first = worker.mp3Converter().convert(new Blob([new Uint8Array([1])]), firstProgress)
        const second = (format === "mp3" ? worker.mp3Converter() : worker.flacConverter())
            .convert(new Blob([new Uint8Array([2])]), secondProgress)
        await vi.waitFor(() => expect(ffmpeg.exec).toHaveBeenCalledTimes(1))
        expect(ffmpeg.writeFile).toHaveBeenCalledTimes(1)
        gate.resolve()
        expect(Array.from(new Uint8Array(await first))).toEqual([1])
        expect(Array.from(new Uint8Array(await second))).toEqual([2])
        expect(firstProgress).not.toHaveBeenCalled()
        expect(secondProgress).toHaveBeenCalledExactlyOnceWith(0.2)
        expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(4)
    })
    it("releases the queue after failure", async () => {
        const {worker, ffmpeg} = setup()
        const primary = new Error("synthetic exec")
        ffmpeg.exec.mockRejectedValueOnce(primary)
        const first = worker.mp3Converter().convert(new Blob(["a"]), () => {})
        const second = worker.flacConverter().convert(new Blob(["b"]), () => {})
        await expect(first).rejects.toBe(primary)
        expect(Array.from(new Uint8Array(await second))).toEqual([98])
        expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(4)
    })
})


describe("encoder outcome integrity", () => {
    it.each(["mp3", "flac"] as const)("refuses stale %s output after nonzero exit and permits retry", async format => {
        const {worker, ffmpeg} = setup()
        ffmpeg.exec.mockResolvedValueOnce(7)
        ffmpeg.readFile.mockResolvedValueOnce(new Uint8Array([99]))
        const converter = format === "mp3" ? worker.mp3Converter() : worker.flacConverter()
        await expect(converter.convert(new Blob(["a"]), () => {})).rejects.toThrow("conversion failed")
        expect(ffmpeg.readFile).not.toHaveBeenCalled()
        expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2)
        await expect(converter.convert(new Blob(["b"]), () => {})).resolves.toBeInstanceOf(ArrayBuffer)
        expect(ffmpeg.readFile).toHaveBeenCalledTimes(1)
    })
    it.each(["mp3", "flac"] as const)("preserves %s exec/read errors and success when either deletion fails", async format => {
        for (const failure of ["exec", "read", "none"]) {
            for (const deletion of [0, 1]) {
                const {worker, ffmpeg} = setup()
                const primary = new Error("synthetic primary")
                const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {})
                if (failure === "exec") ffmpeg.exec.mockRejectedValueOnce(primary)
                if (failure === "read") ffmpeg.readFile.mockRejectedValueOnce(primary)
                ffmpeg.deleteFile.mockImplementation(async () => {
                    if (ffmpeg.deleteFile.mock.calls.length - 1 === deletion) throw new Error("synthetic deletion")
                })
                const converter = format === "mp3" ? worker.mp3Converter() : worker.flacConverter()
                const result = converter.convert(new Blob(["a"]), () => {})
                if (failure === "none") await expect(result).resolves.toBeInstanceOf(ArrayBuffer)
                else await expect(result).rejects.toBe(primary)
                expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2)
                expect(diagnostic).toHaveBeenCalledExactlyOnceWith("[FFmpeg] Temporary file cleanup failed")
                diagnostic.mockRestore()
            }
        }
    })
})
