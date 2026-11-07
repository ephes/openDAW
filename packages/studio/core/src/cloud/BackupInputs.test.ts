import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Option, Progress, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {ProjectStorage} from "../project/ProjectStorage"
import {ProjectMeta} from "../project/ProjectMeta"
import {SampleStorage, OpenSampleAPI} from "../samples"
import {SoundfontStorage, OpenSoundfontAPI} from "../soundfont"
import {PresetStorage, OpenPresetAPI} from "../presets"
import {Workers} from "../Workers"
import {CloudBackupSamples} from "./CloudBackupSamples"
import {CloudBackupSoundfonts} from "./CloudBackupSoundfonts"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {CloudBackupProjects} from "./CloudBackupProjects"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const b = "00000000-0000-4000-8000-000000000002" as UUID.String
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
const sample = {uuid: a, name: "Synthetic", bpm: 120, duration: 1, sample_rate: 44100, origin: "import" as const}
const soundfont = {uuid: a, name: "Synthetic", size: 1, url: "", license: "", origin: "import" as const}
const preset = {uuid: a, name: "Synthetic", created: 1, modified: 2, description: "", category: "audio-effect-chain" as const}
const metas = {Projects: ProjectMeta.init("Synthetic"), Samples: sample, Soundfonts: soundfont, Presets: preset}
const backups = {Projects: CloudBackupProjects, Samples: CloudBackupSamples, Soundfonts: CloudBackupSoundfonts, Presets: CloudBackupPresets}
type Domain = keyof typeof backups
beforeEach(() => {
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})

    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (path === "presets/user/index.json") {return new Uint8Array(json([]))}
        throw new DOMException("missing", "NotFoundError")
    })
    vi.spyOn(ProjectStorage, "listProjects").mockResolvedValue([{uuid: UUID.parse(b), meta: ProjectMeta.init("Local")}])
    vi.spyOn(ProjectStorage, "loadProject").mockResolvedValue(new ArrayBuffer(1))
    vi.spyOn(ProjectStorage, "loadMeta").mockResolvedValue(json(ProjectMeta.init("Local")))
    vi.spyOn(ProjectStorage, "loadCover").mockResolvedValue(Option.None)
    vi.spyOn(SampleStorage.get(), "list").mockResolvedValue([{...sample, uuid: b}])
    vi.spyOn(SoundfontStorage.get(), "list").mockResolvedValue([{...soundfont, uuid: b}])
    vi.spyOn(SampleStorage.get(), "load").mockResolvedValue([{
        frames: [new Float32Array(new SharedArrayBuffer(8))], sampleRate: 44100, numberOfFrames: 2, numberOfChannels: 1
    }, {} as never, sample])
    vi.spyOn(SoundfontStorage.get(), "load").mockResolvedValue([new ArrayBuffer(1), soundfont])
    vi.spyOn(PresetStorage, "load").mockResolvedValue(new ArrayBuffer(1))
    vi.spyOn(PresetStorage, "readIndex").mockResolvedValue([{...preset, uuid: b}])
    vi.spyOn(OpenSampleAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSampleAPI.get>)
    vi.spyOn(OpenSoundfontAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSoundfontAPI.get>)
    vi.spyOn(OpenPresetAPI, "get").mockReturnValue({list: async () => []} as unknown as ReturnType<typeof OpenPresetAPI.get>)
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
for (const domain of Object.keys(backups) as Domain[]) {
    const backup = backups[domain]
    for (const kind of ["container", "null entry", "invalid fields", "duplicate UUID"] as const) {
        it(`${domain} validates the entire remote catalog before any effects: ${kind}`, async () => {
            const good = metas[domain]
            let value: unknown
            if (domain === "Projects") {
                value = kind === "container" ? [] : kind === "null entry" ? {[a]: good, [b]: null}
                    : kind === "invalid fields" ? {[a]: Object.assign({}, good, {modified: "not-a-date"})} : {"aaaaaaaa-0000-4000-8000-000000000001": good, "AAAAAAAA-0000-4000-8000-000000000001": good}
            } else {
                value = kind === "container" ? {} : kind === "null entry" ? [good, null]
                    : kind === "invalid fields" ? [Object.assign({}, good, domain === "Presets" ? {modified: "invalid"} : {name: null})] : [good, good]
            }
            const cloud = {download: vi.fn().mockResolvedValue(json(value)), upload: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn(), alive: vi.fn()}
            await expect(backup.start(cloud, Progress.Empty, () => {})).rejects.toThrow("Invalid cloud catalog")
            expect(cloud.upload).not.toHaveBeenCalled()
            expect(cloud.delete).not.toHaveBeenCalled()
            expect(cloud.download).toHaveBeenCalledTimes(1)
            expect(Workers.Opfs.write).not.toHaveBeenCalled()
        })
    }
    for (const fault of ["permission", "invalid JSON", "invalid UUIDs"] as const) {
        it(`${domain} refuses domain effects when deletion intent is ${fault}`, async () => {
            if (fault === "permission") {vi.mocked(Workers.Opfs.read).mockRejectedValue(new DOMException("denied", "SecurityError"))}
            else {vi.mocked(Workers.Opfs.read).mockResolvedValue(new Uint8Array(fault === "invalid JSON" ? new TextEncoder().encode("{") : json(["invalid"])))}
            const cloud = {download: vi.fn().mockResolvedValue(json(domain === "Projects" ? {} : [])), upload: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn(), alive: vi.fn()}
            await expect(backup.start(cloud, Progress.Empty, () => {})).rejects.toThrow()
            expect(cloud.upload).not.toHaveBeenCalled()
            expect(cloud.delete).not.toHaveBeenCalled()
            expect(cloud.download).toHaveBeenCalledTimes(1)
            expect(Workers.Opfs.write).not.toHaveBeenCalled()
        })
    }
}
for (const read of [() => ProjectStorage.loadTrashedIds(), () => PresetStorage.loadTrashedIds(), () => SampleStorage.get().loadTrashedIds(), () => SoundfontStorage.get().loadTrashedIds()]) {
    it("distinguishes missing journals from invalid shape and preserves valid tombstones", async () => {
        expect(await read()).toEqual([])
        for (const value of [null, {}, "wrong", [null], ["invalid"]]) {
            vi.mocked(Workers.Opfs.read).mockResolvedValue(new Uint8Array(json(value)))
            await expect(read()).rejects.toThrow("Invalid deletion journal")
        }
        vi.mocked(Workers.Opfs.read).mockResolvedValue(new Uint8Array(json([a, b])))
        expect(await read()).toEqual([a, b])
    })
}

for (const domain of Object.keys(backups) as Domain[]) {
    it(`${domain} honors a valid journal without restoring its tombstone`, async () => {
        vi.mocked(ProjectStorage.listProjects).mockResolvedValue([])
        vi.mocked(SampleStorage.get().list).mockResolvedValue([])
        vi.mocked(SoundfontStorage.get().list).mockResolvedValue([])
        vi.mocked(PresetStorage.readIndex).mockResolvedValue([])
        vi.mocked(Workers.Opfs.read).mockResolvedValue(new Uint8Array(json([a])))
        vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
        const value = domain === "Projects" ? {[a]: metas.Projects} : [metas[domain]]
        const cloud = {download: vi.fn().mockResolvedValue(json(value)), upload: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn(), alive: vi.fn()}
        await backups[domain].start(cloud, Progress.Empty, () => {})
        expect(cloud.download).toHaveBeenCalledTimes(1)
        expect(cloud.upload).not.toHaveBeenCalled()
        expect(cloud.delete).not.toHaveBeenCalled()
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
}

for (const domain of Object.keys(backups) as Domain[]) {
    it(`${domain} refuses invalid local metadata before poisoning a cloud catalog`, async () => {
        if (domain === "Projects") {vi.mocked(ProjectStorage.listProjects).mockResolvedValue([{uuid: UUID.parse(b), meta: {name: "Incomplete"} as ProjectMeta}])}
        if (domain === "Samples") {vi.mocked(SampleStorage.get().list).mockResolvedValue([{...sample, duration: NaN}])}
        if (domain === "Soundfonts") {vi.mocked(SoundfontStorage.get().list).mockResolvedValue([{...soundfont, size: NaN}])}
        if (domain === "Presets") {vi.mocked(PresetStorage.readIndex).mockResolvedValue([{...preset, modified: NaN}])}
        const cloud = {download: vi.fn().mockResolvedValue(json(domain === "Projects" ? {} : [])), upload: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn(), alive: vi.fn()}
        await expect(backups[domain].start(cloud, Progress.Empty, () => {})).rejects.toThrow("Invalid local catalog")
        expect(cloud.upload).not.toHaveBeenCalled()
        expect(cloud.delete).not.toHaveBeenCalled()
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
}
for (const operation of ["save", "remove"] as const) {
    it(`preserves preset bytes/index when ${operation} cannot read deletion intent`, async () => {
        vi.mocked(Workers.Opfs.read).mockRejectedValue(new DOMException("denied", "SecurityError"))
        const task = operation === "save" ? PresetStorage.save(preset, new ArrayBuffer(1)) : PresetStorage.remove(UUID.parse(a))
        await expect(task).rejects.toThrow("denied")
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
        expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    })
}
it("preserves a preset when its tombstone cannot be committed", async () => {
    vi.mocked(Workers.Opfs.write).mockRejectedValue(new Error("journal write failed"))
    await expect(PresetStorage.remove(UUID.parse(a))).rejects.toThrow("journal write failed")
    expect(Workers.Opfs.write).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Workers.Opfs.write).mock.calls[0][0]).toBe("presets/user/trash.json")
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
})
it("round-trips extensions and opaque future preset device keys", async () => {
    const {parsePresetsCatalog, parseSamplesCatalog, parseSoundfontsCatalog, parseProjectsCatalog} = await import("./catalogs")
    const entries = [
        {...preset, category: "instrument", device: "FutureInstrument", extension: {custom: true}},
        {...preset, uuid: b, category: "audio-unit", instrument: "LegacyInstrument", extension: 7}
    ]
    expect(parsePresetsCatalog(json(entries))).toEqual(entries)
    expect(parseSamplesCatalog(json([{...sample, extension: 7}]))).toEqual([{...sample, extension: 7}])
    expect(parseSoundfontsCatalog(json([{...soundfont, extension: 7}]))).toEqual([{...soundfont, extension: 7}])
    const projects = {[a]: Object.assign({}, metas.Projects, {extension: 7})}
    expect(parseProjectsCatalog(json(projects))).toEqual(projects)
})
