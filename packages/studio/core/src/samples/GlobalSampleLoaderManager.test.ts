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
    expect(await first).toBe("offline")
    expect(await Promise.race([second, Promise.resolve("pending")])).toBe("offline")
    storage.load.mockResolvedValue(stored(5))
    manager.invalidate(uuid)
    expect((await manager.getAudioData(uuid)).frames[0][0]).toBe(5)
    nextOwner.terminate()
})
