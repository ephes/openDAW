import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Progress, UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {Peaks} from "@opendaw/lib-fusion"
import {SampleMetaData} from "@opendaw/studio-adapters"
import {GlobalSampleLoaderManager} from "./GlobalSampleLoaderManager"
import {SampleStorage} from "./SampleStorage"
import {Workers} from "../Workers"

vi.mock("./SampleStorage", () => ({SampleStorage: {get: () => storage}}))
vi.mock("../Workers", () => ({Workers: {Peak: {generateAsync: vi.fn()}}}))
const storage = {load: vi.fn(), save: vi.fn()}
const uuid = UUID.parse("00000000-0000-4000-8000-000000000001")
const meta: SampleMetaData = {name: "Synthetic", bpm: 0, duration: 1, sample_rate: 44100, origin: "import"}
const audio = (value: number): AudioData => ({sampleRate: 44100, numberOfFrames: 1, numberOfChannels: 1, frames: [new Float32Array([value])]})
const stored = (value: number): [AudioData, Peaks, SampleMetaData] => [audio(value), {} as Peaks, meta]
const flush = async () => {for (let index = 0; index < 30; index++) {await Promise.resolve()}}
beforeEach(() => {vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {})})
afterEach(() => vi.restoreAllMocks())

it("keeps the replacement pending and its result when old storage completes after invalidation", async () => {
    const old = Promise.withResolvers<ReturnType<typeof stored>>()
    const replacement = Promise.withResolvers<ReturnType<typeof stored>>()
    storage.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise)
    const manager = new GlobalSampleLoaderManager({fetch: vi.fn()})
    const loader = manager.getOrCreate(uuid)
    manager.invalidate(uuid)
    old.resolve(stored(1)); await flush()
    expect(loader.data.isEmpty()).toBe(true)
    replacement.resolve(stored(2)); await flush()
    expect((await manager.getAudioData(uuid)).frames[0][0]).toBe(2)
})

it("fences stale fallback, progress and peak completion", async () => {
    const old = Promise.withResolvers<ReturnType<typeof stored>>()
    const replacement = Promise.withResolvers<ReturnType<typeof stored>>()
    storage.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise)
    const fetch = vi.fn()
    const manager = new GlobalSampleLoaderManager({fetch})
    manager.getOrCreate(uuid)
    manager.invalidate(uuid)
    old.reject(new Error("missing")); await flush()
    expect(fetch).not.toHaveBeenCalled()
    replacement.resolve(stored(2)); await flush()
    const peaks = Promise.withResolvers<ArrayBuffer>()
    let report: Progress.Handler = () => {}
    storage.load.mockRejectedValue(new Error("missing"))
    fetch.mockImplementation(async (_uuid, progress) => {report = progress; return [audio(3), meta]})
    vi.mocked(Workers.Peak.generateAsync).mockReturnValue(peaks.promise)
    manager.invalidate(uuid); await flush()
    storage.load.mockResolvedValue(stored(4))
    manager.invalidate(uuid); await flush()
    report(0.5)
    expect(manager.getOrCreate(uuid).state.type).toBe("loaded")
    peaks.resolve(new ArrayBuffer(0)); await flush()
    expect(storage.save).not.toHaveBeenCalled()
    expect((await manager.getAudioData(uuid)).frames[0][0]).toBe(4)
})

it("settles owner and rejoining reader on failure and allows retry", async () => {
    storage.load.mockRejectedValue(new Error("missing"))
    const request = Promise.withResolvers<[AudioData, SampleMetaData]>()
    const manager = new GlobalSampleLoaderManager({fetch: vi.fn().mockReturnValue(request.promise)})
    const owner = manager.register(uuid)
    const first = manager.getAudioData(uuid).then(() => "loaded", error => error.message)
    await flush()
    owner.terminate()
    const nextOwner = manager.register(uuid)
    const second = manager.getAudioData(uuid).then(() => "loaded", error => error.message)
    request.reject(new Error("offline")); await flush()
    expect(await first).toBe("Sample load retired")
    expect(await Promise.race([second, Promise.resolve("pending")])).toBe("offline")
    storage.load.mockResolvedValue(stored(5))
    manager.invalidate(uuid)
    expect((await manager.getAudioData(uuid)).frames[0][0]).toBe(5)
    nextOwner.terminate()
})

it("releases each registration once without evicting the other owner", async () => {
    storage.load.mockResolvedValue(stored(1))
    const manager = new GlobalSampleLoaderManager({fetch: vi.fn()})
    const first = manager.register(uuid)
    const second = manager.register(uuid)
    const loader = manager.getOrCreate(uuid)
    await manager.getAudioData(uuid)
    first.terminate(); first.terminate()
    expect(manager.getOrCreate(uuid)).toBe(loader)
    second.terminate()
    expect(manager.getOrCreate(uuid)).not.toBe(loader)
    await flush()
})

for (const retirement of ["remove", "release"] as const) {
    it(`does not retain late PCM after ${retirement}, while unregistered callers still work`, async () => {
        const pending = Promise.withResolvers<ReturnType<typeof stored>>()
        storage.load.mockReturnValueOnce(pending.promise).mockResolvedValue(stored(2))
        const manager = new GlobalSampleLoaderManager({fetch: vi.fn()})
        const owner = manager.register(uuid)
        const retired = manager.getOrCreate(uuid)
        if (retirement === "remove") {manager.remove(uuid)} else {owner.terminate()}
        pending.resolve(stored(1)); await flush()
        expect(retired.data.isEmpty()).toBe(true)
        const active = manager.getOrCreate(uuid)
        expect((await manager.getAudioData(uuid)).frames[0][0]).toBe(2)
        expect(storage.load).toHaveBeenCalledTimes(2)
        expect(manager.getOrCreate(uuid)).toBe(active)
    })
}

it("does not save or cache a load evicted during peak generation", async () => {
    const peaks = Promise.withResolvers<ArrayBuffer>()
    storage.load.mockRejectedValue(new Error("missing"))
    vi.mocked(Workers.Peak.generateAsync).mockReturnValue(peaks.promise)
    const manager = new GlobalSampleLoaderManager({fetch: vi.fn().mockResolvedValue([audio(1), meta])})
    const owner = manager.register(uuid)
    manager.getOrCreate(uuid); await flush()
    owner.terminate()
    peaks.resolve(new ArrayBuffer(0)); await flush()
    expect(storage.save).not.toHaveBeenCalled()
    storage.load.mockResolvedValue(stored(3))
    expect((await manager.getAudioData(uuid)).frames[0][0]).toBe(3)
})

it("does not let an old registration release a new owner's generation", async () => {
    storage.load.mockResolvedValue(stored(1))
    const manager = new GlobalSampleLoaderManager({fetch: vi.fn()})
    const old = manager.register(uuid)
    manager.remove(uuid)
    const current = manager.register(uuid)
    const loader = manager.getOrCreate(uuid)
    await manager.getAudioData(uuid)
    old.terminate()
    expect(manager.getOrCreate(uuid)).toBe(loader)
    current.terminate()
})
