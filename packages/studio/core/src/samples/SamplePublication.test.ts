import {beforeEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {SamplePeaks} from "@opendaw/lib-fusion"
import {SampleStorage} from "./SampleStorage"
import {Workers} from "../Workers"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}}}))
const id = "00000000-0000-4000-8000-000000000001" as UUID.String
const path = `${SampleStorage.Folder}/${id}`
const files = new Map<string, Uint8Array>()
const frames = new Float32Array(new SharedArrayBuffer(8))
const sample = {
    uuid: UUID.parse(id),
    audio: {frames: [frames], sampleRate: 44100, numberOfFrames: 2, numberOfChannels: 1},
    peaks: new SamplePeaks([], [new Int32Array(0)], 2, 1).toArrayBuffer() as ArrayBuffer,
    meta: {name: "Synthetic", duration: 2 / 44100, sample_rate: 44100, bpm: 0, origin: "import"}
} as SampleStorage.NewSample

beforeEach(() => {
    vi.clearAllMocks()
    files.clear()
    let queue: Promise<unknown> = Promise.resolve()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (_name: string, task: () => Promise<unknown>) => {
        const next = queue.catch(() => {}).then(task)
        queue = next
        return next
    }}})
    vi.mocked(Workers.Opfs.list).mockImplementation(async () => files.size === 0 ? [] : [{name: id, kind: "directory"}])
    vi.mocked(Workers.Opfs.read).mockImplementation(async file => {
        if (!files.has(file)) {throw new DOMException("missing", "NotFoundError")}
        return files.get(file)!
    })
    vi.mocked(Workers.Opfs.write).mockImplementation(async (file, data) => {files.set(file, data)})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async () => {files.clear()})
})
for (const file of ["audio.wav", "peaks.bin", "meta.json"]) {
    it(`cleans only its new sample after a partial ${file} write and permits retry`, async () => {
        vi.mocked(Workers.Opfs.write).mockImplementation(async (name, data) => {
            files.set(name, data)
            if (name.endsWith(file)) {throw new Error("disk full")}
        })
        await expect(SampleStorage.get().save(sample)).rejects.toThrow("disk full")
        expect(files.size).toBe(0)
        expect(await SampleStorage.get().list()).toEqual([])
        vi.mocked(Workers.Opfs.write).mockImplementation(async (name, data) => {files.set(name, data)})
        await SampleStorage.get().save(sample)
        expect((await SampleStorage.get().load(sample.uuid))[0].numberOfFrames).toBe(2)
        expect(vi.mocked(Workers.Opfs.write).mock.calls.at(-1)![0]).toBe(`${path}/meta.json`)
    })
}
it("does not advertise metadata while required audio is pending or rejected", async () => {
    const {promise, reject} = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(Workers.Opfs.write).mockImplementation(async (file, data) => {
        if (file.endsWith("audio.wav")) {entered.resolve(); await promise}
        files.set(file, data)
    })
    const saving = SampleStorage.get().save(sample)
    await entered.promise
    expect(files.has(`${path}/meta.json`)).toBe(false)
    reject(new Error("audio failed"))
    await expect(saving).rejects.toThrow("audio failed")
    expect(files.size).toBe(0)
})
it("serializes same-UUID saves and preserves an already complete asset", async () => {
    await Promise.all([SampleStorage.get().save(sample), SampleStorage.get().save(sample)])
    expect(Workers.Opfs.write).toHaveBeenCalledTimes(3)
    const original = files.get(`${path}/audio.wav`)!.slice()
    vi.mocked(Workers.Opfs.write).mockRejectedValue(new Error("must not overwrite"))
    await SampleStorage.get().save(sample)
    expect(files.get(`${path}/audio.wav`)).toEqual(original)
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
})
it("preserves an existing incomplete folder for recovery", async () => {
    files.set(`${path}/audio.wav`, new Uint8Array([7]))
    await expect(SampleStorage.get().save(sample)).rejects.toThrow()
    expect(files.get(`${path}/audio.wav`)).toEqual(new Uint8Array([7]))
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
