import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Errors, Progress, UUID} from "@opendaw/lib-std"
import {SampleStorage, OpenSampleAPI} from "./samples"
import {SoundfontStorage, OpenSoundfontAPI} from "./soundfont"
import {CloudBackupSamples} from "./cloud/CloudBackupSamples"
import {CloudBackupSoundfonts} from "./cloud/CloudBackupSoundfonts"
import {Workers} from "./Workers"

vi.mock("./Workers", () => ({Workers: {Opfs: {list: vi.fn(), read: vi.fn(), write: vi.fn(), delete: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const b = "00000000-0000-4000-8000-000000000002" as UUID.String
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
beforeEach(() => {
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})
    vi.mocked(Workers.Opfs.write).mockResolvedValue()

    vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: a, kind: "directory"}])
    vi.mocked(Workers.Opfs.read).mockResolvedValue(json({name: "Synthetic"}))
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
for (const storage of [SampleStorage.get(), SoundfontStorage.get()]) {
    for (const meta of [null, [], {uuid: b}, {uuid: null}]) {
        it(`rejects aliased/invalid metadata ${JSON.stringify(meta)} in ${storage.folder}`, async () => {
            vi.mocked(Workers.Opfs.read).mockResolvedValue(json(meta))
            expect(await storage.list()).toEqual([])
            await expect(storage.list({strict: true})).rejects.toThrow("Cannot scan local asset")
            expect(Workers.Opfs.write).not.toHaveBeenCalled()
        })
    }
    it(`keeps the physical UUID when metadata omits identity in ${storage.folder}`, async () => {
        expect(await storage.list({strict: true})).toEqual([{uuid: a, name: "Synthetic"}])
        vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: "invalid", kind: "directory"}])
        expect(await storage.list()).toEqual([])
        await expect(storage.list({strict: true})).rejects.toThrow("Cannot scan local asset")
    })
    it(`distinguishes missing storage from inaccessible storage in ${storage.folder}`, async () => {
        vi.mocked(Workers.Opfs.list).mockRejectedValue(new DOMException("missing", "NotFoundError"))
        expect(await storage.list({strict: true})).toEqual([])
        vi.mocked(Workers.Opfs.list).mockRejectedValue(new DOMException("denied", "SecurityError"))
        expect(await storage.list()).toEqual([])
        await expect(storage.list({strict: true})).rejects.toThrow("denied")
    })
}
for (const domain of ["samples", "soundfonts"] as const) {
    for (const fault of ["list", "read", "parse"] as const) {
        it(`stops ${domain} backup before any effects on ${fault} failure`, async () => {
            vi.spyOn(OpenSampleAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSampleAPI.get>)
            vi.spyOn(OpenSoundfontAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSoundfontAPI.get>)
            const sampleSave = vi.spyOn(SampleStorage.get(), "save").mockResolvedValue()
            const soundfontSave = vi.spyOn(SoundfontStorage.get(), "save").mockResolvedValue()
            if (fault === "parse") {vi.mocked(Workers.Opfs.read).mockResolvedValue(new TextEncoder().encode("{"))}
            else {vi.mocked(Workers.Opfs[fault]).mockRejectedValue(new DOMException("denied", "SecurityError"))}
            const cloud = {download: vi.fn().mockRejectedValue(new Errors.FileNotFound("index")), upload: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn(), alive: vi.fn()}
            const backup = domain === "samples" ? CloudBackupSamples : CloudBackupSoundfonts
            await expect(backup.start(cloud, Progress.Empty, () => {})).rejects.toThrow()
            expect(cloud.upload).not.toHaveBeenCalled()
            expect(cloud.delete).not.toHaveBeenCalled()
            expect(cloud.download).toHaveBeenCalledTimes(1)
            expect(sampleSave).not.toHaveBeenCalled()
            expect(soundfontSave).not.toHaveBeenCalled()
            expect(Workers.Opfs.write).not.toHaveBeenCalled()
        })
    }
}

it("waits for a soundfont writer before taking a strict inventory", async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {release = resolve})
    vi.mocked(Workers.Opfs.write).mockImplementation(async path => {if (path.endsWith("soundfont.sf2")) {await gate}})
    const storage = SoundfontStorage.get()
    const saving = storage.save({uuid: UUID.parse(a), file: new ArrayBuffer(1), meta: {name: "Synthetic", size: 1, url: "", license: "", origin: "import"}})
    await vi.waitFor(() => expect(Workers.Opfs.write).toHaveBeenCalled())
    const listing = storage.list({strict: true})
    await Promise.resolve(); await Promise.resolve()
    expect(Workers.Opfs.list).not.toHaveBeenCalled()
    release(); await saving
    expect(await listing).toEqual([{uuid: a, name: "Synthetic"}])
})
