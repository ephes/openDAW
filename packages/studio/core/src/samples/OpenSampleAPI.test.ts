// @vitest-environment node
import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {WavFile} from "@opendaw/lib-dsp"
import type {OpenSampleAPI} from "./OpenSampleAPI"

const network = vi.hoisted(() => ({defaultFetch: vi.fn(), limitFetch: vi.fn()}))
vi.mock("@opendaw/lib-runtime", async original => ({...await original<typeof import("@opendaw/lib-runtime")>(), network}))
const uuid = UUID.parse("abcdef00-0000-4000-8000-000000000001")
const sample = {uuid: UUID.toString(uuid), name: "Synthetic", bpm: 0, duration: 1, sample_rate: 44100, origin: "openDAW"}
let api: OpenSampleAPI
beforeEach(async () => {
    vi.resetModules(); vi.resetAllMocks()
    api = (await import("./OpenSampleAPI")).OpenSampleAPI.get()
})
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers()})

it("coalesces catalog reads, exposes failure and retries an explicit later read", async () => {
    const first = Promise.withResolvers<Response>()
    network.defaultFetch.mockReturnValueOnce(first.promise).mockResolvedValueOnce(Response.json([sample]))
    const initial = api.all()
    const joined = api.all()
    const initialError = expect(initial).rejects.toThrow("offline")
    const joinedError = expect(joined).rejects.toThrow("offline")
    first.reject(new Error("offline"))
    await Promise.all([initialError, joinedError])
    expect(network.defaultFetch).toHaveBeenCalledTimes(1)
    expect(await api.all()).toEqual([sample])
    expect(await api.all()).toEqual([sample])
    expect(network.defaultFetch).toHaveBeenCalledTimes(2)
})

it("caches a successful empty catalog", async () => {
    network.defaultFetch.mockResolvedValue(Response.json([]))
    expect(await api.all()).toEqual([])
    expect(await api.all()).toEqual([])
    expect(network.defaultFetch).toHaveBeenCalledTimes(1)
})

it("does not cache HTTP or schema failures", async () => {
    network.defaultFetch.mockResolvedValueOnce(new Response("unavailable", {status: 503}))
        .mockResolvedValueOnce(Response.json([{invalid: true}])).mockResolvedValueOnce(Response.json([sample]))
    await expect(api.all()).rejects.toThrow()
    await expect(api.all()).rejects.toThrow()
    expect(await api.all()).toEqual([sample])
})

it("rejects metadata for a different UUID before downloading any PCM", async () => {
    network.limitFetch.mockResolvedValue(Response.json({...sample, uuid: "abcdef00-0000-4000-8000-000000000002"}))
    await expect(api.load(uuid, vi.fn())).rejects.toThrow("identity")
    expect(network.limitFetch).toHaveBeenCalledTimes(1)
})

it("accepts equivalent UUID case and returns canonical lower-case identity", async () => {
    network.limitFetch.mockResolvedValue(Response.json({...sample, uuid: sample.uuid.toUpperCase()}))
    expect((await api.get(uuid)).uuid).toBe(sample.uuid)
})

const limit = 64 * 1024 * 1024
const stream = (chunks: Uint8Array[], length?: string) => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            const chunk = chunks.shift()
            if (chunk === undefined) {controller.close()} else {controller.enqueue(chunk)}
        }, cancel
    }, {highWaterMark: 0})
    const response = new Response(body, {headers: length === undefined ? {} : {"Content-Length": length}})
    const reader = body.getReader()
    const release = vi.spyOn(reader, "releaseLock")
    vi.spyOn(body, "getReader").mockReturnValue(reader)
    return {response, cancel, release}
}
const serve = (response: Response) => {
    network.limitFetch.mockResolvedValueOnce(Response.json(sample)).mockResolvedValueOnce(response)
}

it("refuses declared excess before reading or decoding and releases the body", async () => {
    const transfer = stream([new Uint8Array(1)], String(limit + 1))
    serve(transfer.response)
    const decode = vi.spyOn(WavFile, "decodeFloats")
    await expect(api.load(uuid, vi.fn())).rejects.toThrow("limit")
    expect(decode).not.toHaveBeenCalled()
    expect(transfer.cancel).toHaveBeenCalledTimes(1)
    expect(transfer.release).toHaveBeenCalledTimes(1)
})

for (const length of [undefined, "1"]) {
    it(`bounds actual bytes with ${length === undefined ? "missing" : "lying"} Content-Length`, async () => {
        const transfer = stream([new Uint8Array(limit), new Uint8Array(1)], length)
        serve(transfer.response)
        const decode = vi.spyOn(WavFile, "decodeFloats")
        await expect(api.load(uuid, vi.fn())).rejects.toThrow("limit")
        expect(decode).not.toHaveBeenCalled()
        expect(transfer.cancel).toHaveBeenCalledTimes(1)
        expect(transfer.release).toHaveBeenCalledTimes(1)
    })
}

it("loads a short synthetic WAV and releases its reader", async () => {
    const wav = new Uint8Array(WavFile.encodeFloats({sampleRate: 44100, numberOfFrames: 2,
        numberOfChannels: 1, frames: [new Float32Array(new SharedArrayBuffer(8)).fill(0.25)]}))
    const transfer = stream([wav], String(wav.byteLength))
    serve(transfer.response)
    const [audio, metadata] = await api.load(uuid, vi.fn())
    expect(audio.frames[0][0]).toBe(0.25)
    expect(metadata.uuid).toBe(sample.uuid)
    expect(transfer.release).toHaveBeenCalledTimes(1)
    expect(transfer.cancel).not.toHaveBeenCalled()
})

for (const trickle of [false, true]) {
    it(`expires the total body budget for a ${trickle ? "trickling" : "stalled"} response and permits retry`, async () => {
        vi.useFakeTimers()
        let stop = () => {}
        const cancel = vi.fn(() => stop())
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                if (trickle) {
                    const timer = setInterval(() => controller.enqueue(new Uint8Array([0])), 10000)
                    stop = () => clearInterval(timer)
                }
            }, cancel
        }, {highWaterMark: 0})
        const response = new Response(body)
        const reader = body.getReader()
        const release = vi.spyOn(reader, "releaseLock")
        vi.spyOn(body, "getReader").mockReturnValue(reader)
        serve(response)
        const decode = vi.spyOn(WavFile, "decodeFloats")
        const outcome = api.load(uuid, vi.fn()).then(() => "loaded", error => error.message)
        await vi.advanceTimersByTimeAsync(60000)
        expect(await Promise.race([outcome, Promise.resolve("pending")])).toContain("deadline")
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(release).toHaveBeenCalledTimes(1)
        expect(decode).not.toHaveBeenCalled()
        expect(network.limitFetch.mock.calls[1][1].signal.aborted).toBe(true)
        const wav = new Uint8Array(WavFile.encodeFloats({sampleRate: 44100, numberOfFrames: 1,
            numberOfChannels: 1, frames: [new Float32Array(new SharedArrayBuffer(4))]}))
        serve(stream([wav]).response)
        expect((await api.load(uuid, vi.fn()))[0].numberOfFrames).toBe(1)
    })
}

it("includes metadata discovery in the deadline and prevents late asset fetches", async () => {
    vi.useFakeTimers()
    const metadata = Promise.withResolvers<Response>()
    network.limitFetch.mockReturnValueOnce(metadata.promise)
    const outcome = api.load(uuid, vi.fn()).then(() => "loaded", error => error.message)
    await vi.advanceTimersByTimeAsync(60000)
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toContain("deadline")
    metadata.resolve(Response.json(sample))
    await vi.advanceTimersByTimeAsync(10000)
    expect(network.limitFetch).toHaveBeenCalledTimes(1)
    expect(network.limitFetch.mock.calls[0][1].signal.aborted).toBe(true)
})

it("does not restart a queued header retry after the deadline", async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<Response>()
    network.limitFetch.mockReturnValue(first.promise)
    const outcome = api.load(uuid, vi.fn()).then(() => "loaded", error => error.message)
    await vi.advanceTimersByTimeAsync(59000)
    first.reject(new Error("offline"))
    await vi.advanceTimersByTimeAsync(10000)
    expect(await outcome).toContain("deadline")
    expect(network.limitFetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
})
