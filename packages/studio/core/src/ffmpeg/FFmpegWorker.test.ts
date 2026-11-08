// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fake = vi.hoisted(() => ({
    load: vi.fn(), terminate: vi.fn(), instances: 0
}))
vi.mock("@ffmpeg/ffmpeg", () => ({
    FFmpeg: class {
        loaded = true
        constructor() { fake.instances++ }
        on() {}
        load = fake.load
        terminate = fake.terminate
    }
}))

beforeEach(() => {
    vi.resetModules()
    fake.instances = 0
    fake.load.mockReset().mockResolvedValue(true)
    fake.terminate.mockReset()
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]), {
        headers: {"content-length": "1"}
    })))
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:core").mockReturnValueOnce("blob:wasm")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("FFmpeg startup ownership", () => {
    it("shares pending and successful initialization between callers", async () => {
        const gate = Promise.withResolvers<boolean>()
        fake.load.mockReturnValue(gate.promise)
        const {FFmpegWorker} = await import("./FFmpegWorker")
        const first = FFmpegWorker.load()
        const second = FFmpegWorker.load()
        await vi.waitFor(() => expect(fake.load).toHaveBeenCalledTimes(1))
        expect(fetch).toHaveBeenCalledTimes(2)
        gate.resolve(true)
        const worker = await first
        expect(await second).toBe(worker)
        expect(await FFmpegWorker.load()).toBe(worker)
        expect(fake.instances).toBe(1)
        expect(fake.terminate).not.toHaveBeenCalled()
        expect(worker.loaded).toBe(true)
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    })
    it("compensates rejected startup and lets the next caller retry", async () => {
        const primary = new Error("synthetic initialization failure")
        fake.load.mockRejectedValueOnce(primary)
        fake.terminate.mockImplementationOnce(() => { throw new Error("cleanup") })
        const {FFmpegWorker} = await import("./FFmpegWorker")
        await expect(FFmpegWorker.load()).rejects.toBe(primary)
        expect(fake.terminate).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:core")
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:wasm")
        expect((await FFmpegWorker.load()).loaded).toBe(true)
        expect(fake.instances).toBe(2)
    })
})

it("replaces a cached worker that has been terminated", async () => {
    const {FFmpegWorker} = await import("./FFmpegWorker")
    const worker = await FFmpegWorker.load()
    worker.ffmpeg.loaded = false
    expect(await FFmpegWorker.load()).not.toBe(worker)
    expect(fake.instances).toBe(2)
})

it.each(["oversized", "truncated", "stalled"])("refuses a synthetic %s core stream", async fault => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
        start(stream) {
            if (fault === "oversized") stream.enqueue(new Uint8Array(2 * 1024 * 1024 + 1))
            if (fault === "truncated") { stream.enqueue(new Uint8Array([1])); stream.close() }
        }, cancel
    })
    vi.mocked(fetch).mockResolvedValue(new Response(body, {
        headers: fault === "truncated" ? {"content-length": "2"} : {}
    }))
    const {FFmpegWorker} = await import("./FFmpegWorker")
    if (fault === "stalled") vi.useFakeTimers()
    try {
        const result = FFmpegWorker.load()
        const refused = expect(result).rejects.toThrow(/size refused|truncated|timed out/)
        if (fault === "stalled") {
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
            await vi.advanceTimersByTimeAsync(120_001)
        }
        await refused
        if (fault !== "truncated") expect(cancel).toHaveBeenCalled()
        expect(fake.load).not.toHaveBeenCalled()
        expect(fake.terminate).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
})

it("accepts ordinary synthetic assets within the documented budgets without lengths", async () => {
    vi.mocked(fetch).mockImplementation(async url => new Response(new Uint8Array(
        String(url).endsWith(".wasm") ? 31 * 1024 * 1024 : 112 * 1024)))
    const {FFmpegWorker} = await import("./FFmpegWorker")
    expect((await FFmpegWorker.load()).loaded).toBe(true)
})

it("bounds stalled core initialization with the same startup deadline", async () => {
    const {FFmpegWorker} = await import("./FFmpegWorker")
    fake.load.mockReturnValue(new Promise(() => {}))
    vi.useFakeTimers()
    try {
        const result = expect(FFmpegWorker.load()).rejects.toThrow("timed out")
        await vi.waitFor(() => expect(fake.load).toHaveBeenCalledTimes(1))
        await vi.advanceTimersByTimeAsync(120_001)
        await result
        expect(fake.terminate).toHaveBeenCalledTimes(1)
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
})


it("accepts decoded compressed bodies independently of encoded Content-Length", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array(100), {
        headers: {"content-encoding": "gzip", "content-length": "10"}
    }))
    const {FFmpegWorker} = await import("./FFmpegWorker")
    expect((await FFmpegWorker.load()).loaded).toBe(true)
})
