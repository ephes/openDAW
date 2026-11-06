import {beforeEach, expect, it, vi} from "vitest"
import {Option, Progress, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {CloudBackupProjects} from "./CloudBackupProjects"
import {CloudBackupSamples} from "./CloudBackupSamples"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {CloudBackupSoundfonts} from "./CloudBackupSoundfonts"
import {CloudHandler} from "./CloudHandler"
import {ProjectStorage} from "../project/ProjectStorage"
import {ProjectMeta} from "../project/ProjectMeta"
import {SampleStorage, OpenSampleAPI} from "../samples"
import {PresetStorage, OpenPresetAPI} from "../presets"
import {SoundfontStorage, OpenSoundfontAPI} from "../soundfont"
import {Workers} from "../Workers"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const b = "00000000-0000-4000-8000-000000000002" as UUID.String
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
const bytes = new Uint8Array([1, 2]).buffer
let remote: Map<string, ArrayBuffer>
let local: Map<string, Uint8Array>
let cloud: CloudHandler

beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    remote = new Map()
    local = new Map()
    cloud = {
        upload: vi.fn(async (path, data) => {remote.set(path, data)}),
        download: vi.fn(async path => {if (!remote.has(path)) {throw new Error(`Missing ${path}`)} return remote.get(path)!}),
        delete: vi.fn(async path => {for (const key of remote.keys()) {if (key === path || key.startsWith(`${path}/`)) {remote.delete(key)}}}),
        list: vi.fn(async path => [...remote.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path!.length + 1))),
        exists: vi.fn(async path => remote.has(path)), alive: vi.fn()
    }
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(true)
    vi.spyOn(Promises, "approvedRetry").mockImplementation(async task => task())
    vi.spyOn(Promises, "guardedRetry").mockImplementation(async task => task())
    vi.spyOn(ProjectStorage, "listProjects").mockResolvedValue([])
    vi.spyOn(ProjectStorage, "loadTrashedIds").mockResolvedValue([])
    vi.spyOn(ProjectStorage, "loadMeta").mockResolvedValue(json(ProjectMeta.init("New")))
    vi.spyOn(ProjectStorage, "loadProject").mockResolvedValue(bytes)
    vi.spyOn(ProjectStorage, "loadCover").mockResolvedValue(Option.None)
    vi.spyOn(ProjectSkeleton, "decode").mockReturnValue({} as ProjectSkeleton)
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {local.set(path, data)})
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (!local.has(path)) {throw new DOMException("missing", "NotFoundError")}
        return local.get(path)!
    })
    vi.mocked(Workers.Opfs.list).mockImplementation(async folder => [...new Set([...local.keys()].filter(path => path.startsWith(`${folder}/`)).map(path => path.slice(folder.length + 1).split("/")[0]))].map(name => ({name, kind: "directory"})))
    vi.mocked(Workers.Opfs.delete).mockImplementation(async folder => {for (const path of local.keys()) {if (path.startsWith(`${folder}/`)) {local.delete(path)}}})
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (name: string, task: () => Promise<unknown>) => {
        const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(name, next)
        return next
    }}})
})

for (const domain of ["Projects", "Samples", "Presets", "Soundfonts"] as const) {
    for (const outcome of ["approve", "cancel", "delete failure", "catalog failure"] as const) {
        it(`${domain} carries uploaded catalog state into ${outcome}`, async () => {
            const fresh = {uuid: a, name: "New", modified: "2026-01-02"}
            const old = {uuid: b, name: "Old", modified: "2026-01-01"}
            const backup = {Projects: CloudBackupProjects, Samples: CloudBackupSamples, Presets: CloudBackupPresets, Soundfonts: CloudBackupSoundfonts}[domain]
            const isProject = domain === "Projects"
            remote.set(backup.RemoteCatalogPath, json(isProject ? {[b]: old} : [old]))
            if (isProject) {
                vi.spyOn(ProjectStorage, "listProjects").mockResolvedValue([{uuid: UUID.parse(a), meta: ProjectMeta.init("New")}])
                vi.spyOn(ProjectStorage, "loadTrashedIds").mockResolvedValue([b])
            } else if (domain === "Presets") {
                vi.spyOn(OpenPresetAPI, "get").mockReturnValue({list: async () => []} as unknown as ReturnType<typeof OpenPresetAPI.get>)
                vi.spyOn(PresetStorage, "readIndex").mockResolvedValue([fresh] as unknown as Awaited<ReturnType<typeof PresetStorage.readIndex>>)
                vi.spyOn(PresetStorage, "loadTrashedIds").mockResolvedValue([b])
                vi.spyOn(PresetStorage, "load").mockResolvedValue(bytes)
            } else if (domain === "Samples") {
                vi.spyOn(OpenSampleAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSampleAPI.get>)
                vi.spyOn(SampleStorage, "get").mockReturnValue({list: async () => [fresh], loadTrashedIds: async () => [b], load: async () => [{frames: [new Float32Array(new SharedArrayBuffer(8))], sampleRate: 44100, numberOfFrames: 2, numberOfChannels: 1}]} as unknown as SampleStorage)
            } else {
                vi.spyOn(OpenSoundfontAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSoundfontAPI.get>)
                vi.spyOn(SoundfontStorage, "get").mockReturnValue({list: async () => [fresh], loadTrashedIds: async () => [b], load: async () => [bytes]} as unknown as SoundfontStorage)
            }
            if (outcome === "cancel") {vi.mocked(RuntimeNotifier.approve).mockResolvedValue(false)}
            if (outcome === "delete failure") {vi.mocked(cloud.delete).mockRejectedValue(new Error("delete failure"))}
            if (outcome === "catalog failure") {
                const upload = cloud.upload
                let catalogs = 0
                cloud.upload = vi.fn(async (path, data) => {
                    if (path === backup.RemoteCatalogPath && ++catalogs === 2) {throw new Error("catalog failure")}
                    await upload(path, data)
                })
            }
            const task = backup.start(cloud, Progress.Empty, () => {})
            if (outcome.endsWith("failure")) {await expect(task).rejects.toThrow(outcome)} else {await task}
            const catalog = JSON.parse(new TextDecoder().decode(remote.get(backup.RemoteCatalogPath)))
            const ids = isProject ? Object.keys(catalog) : catalog.map((entry: {uuid: string}) => entry.uuid)
            expect(ids).toContain(a)
            expect(ids.includes(b)).toBe(outcome !== "approve")
        })
    }
}

const restoreFixture = () => {
    remote.set(CloudBackupProjects.RemoteCatalogPath, json({[a]: ProjectMeta.init("Restore")}))
    remote.set(`projects/${a}/project.od`, bytes)
    remote.set(`projects/${a}/meta.json`, json(ProjectMeta.init("Restore")))
    remote.set(`projects/${a}/image.bin`, bytes)
}
const restore = () => CloudBackupProjects.start(cloud, Progress.Empty, () => {})
for (const position of ["download project.od", "download meta.json", "download image.bin", "write project.od", "write image.bin", "write meta.json"]) {
    it(`keeps restore invisible after ${position} failure and permits retry`, async () => {
        restoreFixture()
        const [operation, file] = position.split(" ")
        if (operation === "download") {
            const download = cloud.download
            cloud.download = vi.fn(async path => {if (path.endsWith(file)) {throw new Error(position)} return download(path)})
        } else {
            vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {
                if (path.endsWith(file)) {local.set(path, data); throw new Error(position)}
                local.set(path, data)
            })
        }
        await expect(restore()).rejects.toThrow(position)
        expect(local.has(`projects/v1/${a}/meta.json`)).toBe(false)
        cloud.download = vi.fn(async path => remote.get(path)!)
        vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {local.set(path, data)})
        await restore()
        expect([...local.keys()]).toHaveLength(3)
        const writes = vi.mocked(Workers.Opfs.write).mock.calls.map(([path]) => path)
        expect(writes.at(-1)).toBe(`projects/v1/${a}/meta.json`)
    })
}
it("preserves a complete existing local project created after the scan", async () => {
    restoreFixture()
    local.set(`projects/v1/${a}/meta.json`, new Uint8Array(json(ProjectMeta.init("Existing"))))
    local.set(`projects/v1/${a}/project.od`, new Uint8Array([9]))
    await restore()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    expect(local.get(`projects/v1/${a}/project.od`)).toEqual(new Uint8Array([9]))
})
it("rejects invalid downloads before any local publication", async () => {
    restoreFixture()
    vi.mocked(ProjectSkeleton.decode).mockImplementation(() => {throw new Error("invalid project")})
    await expect(restore()).rejects.toThrow("invalid project")
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
for (const approved of [true, false]) {
    it(`corrupt project delete=${approved} ends restore without downloading deleted files`, async () => {
        restoreFixture()
        remote.delete(`projects/${a}/project.od`)
        vi.mocked(RuntimeNotifier.approve).mockResolvedValue(approved)
        await restore()
        expect(cloud.download).toHaveBeenCalledTimes(1)
        expect(cloud.delete).toHaveBeenCalledTimes(approved ? 1 : 0)
        const catalog = JSON.parse(new TextDecoder().decode(remote.get(CloudBackupProjects.RemoteCatalogPath)))
        expect(Object.hasOwn(catalog, a)).toBe(!approved)
    })
}
it("propagates corrupt-project deletion and catalog failures", async () => {
    restoreFixture()
    remote.delete(`projects/${a}/project.od`)
    vi.mocked(cloud.delete).mockRejectedValueOnce(new Error("delete failed"))
    await expect(restore()).rejects.toThrow("delete failed")
    vi.mocked(cloud.upload).mockRejectedValueOnce(new Error("catalog failed"))
    await expect(restore()).rejects.toThrow("catalog failed")
    expect(cloud.download).toHaveBeenCalledTimes(2)
})
