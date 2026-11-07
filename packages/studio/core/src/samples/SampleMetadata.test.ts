import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {SamplePeaks} from "@opendaw/lib-fusion"
import {SampleStorage} from "./SampleStorage"
import {Workers} from "../Workers"
vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const root = `samples/v2/${a}`
const meta = {name: "Synthetic", duration: 2 / 44100, sample_rate: 44100, bpm: 0, origin: "import" as const}
const sample: SampleStorage.NewSample = {uuid: UUID.parse(a), meta,
    audio: {frames: [new Float32Array(new SharedArrayBuffer(8))], sampleRate: 44100, numberOfFrames: 2, numberOfChannels: 1},
    peaks: new SamplePeaks([], [new Int32Array(0)], 2, 1).toArrayBuffer() as ArrayBuffer}
let files: Map<string, Uint8Array>
const flush = async () => {for (let i = 0; i < 25; i++) {await Promise.resolve()}}
beforeEach(async () => {
    files = new Map()
    vi.mocked(Workers.Opfs.list).mockResolvedValue([])
    vi.mocked(Workers.Opfs.exists).mockImplementation(async path => (files.get(path)?.byteLength ?? 0) > 0)
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")} return files.get(path)!})
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {for (const key of files.keys()) {if (key.startsWith(`${path}/`)) {files.delete(key)}}})
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})
    await SampleStorage.get().save(sample)
    vi.clearAllMocks()
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
it("rejects a stale queued edit after deletion without recreating metadata or clearing the tombstone", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {
        entered.resolve(); await gate.promise
        for (const key of files.keys()) {if (key.startsWith(`${path}/`)) {files.delete(key)}}
    })
    const deleting = SampleStorage.get().deleteItem(UUID.parse(a))
    await entered.promise
    const editing = SampleStorage.get().updateSampleMeta(UUID.parse(a), {...meta, name: "Stale"})
    const outcome = editing.then(() => "success", () => "rejected")
    await flush()
    expect(vi.mocked(Workers.Opfs.write).mock.calls.some(([path]) => path === `${root}/meta.json`)).toBe(false)
    gate.resolve(); await deleting
    expect(await outcome).toBe("rejected")
    expect([...files.keys()].some(path => path.startsWith(`${root}/`))).toBe(false)
    expect(JSON.parse(new TextDecoder().decode(files.get("samples/v2/trash.json")))).toEqual([a])
})
it("finishes an earlier complete metadata edit before deletion removes all media", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
        if (path === `${root}/meta.json`) {entered.resolve(); await gate.promise}
        files.set(path, bytes.slice())
    })
    const editing = SampleStorage.get().updateSampleMeta(UUID.parse(a), {...meta, name: "Edited"})
    await entered.promise
    const deleting = SampleStorage.get().deleteItem(UUID.parse(a))
    await flush(); expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    gate.resolve(); await Promise.all([editing, deleting])
    expect([...files.keys()].some(path => path.startsWith(`${root}/`))).toBe(false)
    expect(JSON.parse(new TextDecoder().decode(files.get("samples/v2/trash.json")))).toEqual([a])
})
it("rejects an edit to an incomplete target without creating metadata", async () => {
    files.delete(`${root}/audio.wav`)
    await expect(SampleStorage.get().updateSampleMeta(UUID.parse(a), {...meta, name: "Edited"})).rejects.toThrow()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
