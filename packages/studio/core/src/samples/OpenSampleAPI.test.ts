import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
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
