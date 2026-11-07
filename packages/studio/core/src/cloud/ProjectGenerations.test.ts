import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Errors, Option, Progress, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectStorage} from "../project/ProjectStorage"
import {ProjectMeta} from "../project/ProjectMeta"
import {Workers} from "../Workers"
import {CloudBackupProjects} from "./CloudBackupProjects"
import {CloudBackup} from "./CloudBackup"
import {CloudBackupSamples} from "./CloudBackupSamples"
import {CloudBackupSoundfonts} from "./CloudBackupSoundfonts"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {CloudHandler} from "./CloudHandler"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}}}))
vi.mock("../project", () => ({ProjectSignals: {StorageUpdated: "storage"}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const b = "00000000-0000-4000-8000-000000000002" as UUID.String
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
let remote: Map<string, ArrayBuffer>
let local: Map<string, Uint8Array>
let cloud: CloudHandler
let oldMeta: ProjectMeta
let newMeta: ProjectMeta
let oldRoot: string
beforeEach(() => {
    vi.useFakeTimers()
    oldMeta = Object.assign(ProjectMeta.init("Old"), {modified: "2020-01-01T00:00:00.000Z"})
    newMeta = Object.assign(ProjectMeta.init("New"), {modified: "2021-01-01T00:00:00.000Z"})
    oldRoot = `projects/${a}/generations/${b}`
    remote = new Map([["projects/index.json", json({[a]: {...oldMeta as object, generation: b}})], [`${oldRoot}/project.od`, new Uint8Array([1]).buffer], [`${oldRoot}/meta.json`, json(oldMeta)], [`${oldRoot}/image.bin`, new Uint8Array([2]).buffer]])
    local = new Map()
    cloud = {
        upload: vi.fn(async (path, data) => {remote.set(path, data)}),
        download: vi.fn(async path => {if (!remote.has(path)) {throw new Errors.FileNotFound(path)} return remote.get(path)!}),
        list: vi.fn(async path => [...remote.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path!.length + 1))),
        delete: vi.fn(), exists: vi.fn(), alive: vi.fn()
    }
    vi.spyOn(ProjectStorage, "listProjects").mockResolvedValue([{uuid: UUID.parse(a), meta: newMeta}])
    vi.spyOn(ProjectStorage, "loadTrashedIds").mockResolvedValue([])
    vi.spyOn(ProjectStorage, "loadMeta").mockResolvedValue(json(newMeta))
    vi.spyOn(ProjectStorage, "loadProject").mockResolvedValue(new Uint8Array([9]).buffer)
    vi.spyOn(ProjectStorage, "loadCover").mockResolvedValue(Option.wrap(new Uint8Array([8]).buffer))
    vi.spyOn(ProjectSkeleton, "decode").mockReturnValue({} as ProjectSkeleton)
    vi.mocked(Workers.Opfs.list).mockResolvedValue([])
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {local.set(path, data)})
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {if (!local.has(path)) {throw new DOMException("missing", "NotFoundError")} return local.get(path)!})
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate: vi.fn()} as unknown as ReturnType<typeof RuntimeNotifier.progress>)
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})
})
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks()})
const backup = () => CloudBackupProjects.start(cloud, Progress.Empty, () => {})
for (const legacy of [false, true]) {
for (const position of ["project.od", "meta.json", "image.bin", "index.json"]) {
    it(`preserves a restorable previous generation (legacy=${legacy}) after ${position} failure`, async () => {
        if (legacy) {
            const root = `projects/${a}`
            for (const file of ["project.od", "meta.json", "image.bin"]) {remote.set(`${root}/${file}`, remote.get(`${oldRoot}/${file}`)!)}
            oldRoot = root
            remote.set("projects/index.json", json({[a]: oldMeta}))
        }
        const upload = cloud.upload
        cloud.upload = vi.fn(async (path, data, signal) => {
            if (path.endsWith(position)) {throw new Error(`fail ${position}`)}
            await upload(path, data, signal)
        })
        await expect(backup()).rejects.toThrow(`fail ${position}`)
        expect(new Uint8Array(remote.get(`${oldRoot}/project.od`)!)).toEqual(new Uint8Array([1]))
        expect(JSON.parse(new TextDecoder().decode(remote.get("projects/index.json")))[a].generation).toBe(legacy ? undefined : b)
        vi.mocked(ProjectStorage.listProjects).mockResolvedValue([])
        await backup()
        expect(local.get(`projects/v1/${a}/project.od`)).toEqual(new Uint8Array([1]))
        expect(JSON.parse(new TextDecoder().decode(local.get(`projects/v1/${a}/meta.json`))).name).toBe("Old")
        expect(local.get(`projects/v1/${a}/image.bin`)).toEqual(new Uint8Array([2]))
    })
}
}
it("publishes a complete new generation and restores it afresh", async () => {
    await backup()
    const entry = JSON.parse(new TextDecoder().decode(remote.get("projects/index.json")))[a]
    expect(UUID.validateString(entry.generation)).toBe(true)
    expect(entry.generation).not.toBe(b)
    expect(remote.has(`${oldRoot}/project.od`)).toBe(true)
    vi.mocked(ProjectStorage.listProjects).mockResolvedValue([])
    await backup()
    expect(local.get(`projects/v1/${a}/project.od`)).toEqual(new Uint8Array([9]))
    expect(JSON.parse(new TextDecoder().decode(local.get(`projects/v1/${a}/meta.json`))).name).toBe("New")
})
it("rejects unsafe generation references before any mutation", async () => {
    remote.set("projects/index.json", json({[a]: {...oldMeta as object, generation: "../other"}}))
    await expect(backup()).rejects.toThrow("Invalid cloud catalog")
    expect(cloud.upload).not.toHaveBeenCalled()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
for (const retry of [false, true]) {
    it(`retains backup ownership until timed-out work settles, then retry=${retry}`, async () => {
        vi.spyOn(CloudBackupSamples, "start").mockResolvedValue()
        vi.spyOn(CloudBackupSoundfonts, "start").mockResolvedValue()
        vi.spyOn(CloudBackupPresets, "start").mockResolvedValue()
        vi.mocked(RuntimeNotifier.approve).mockResolvedValue(retry)
        let release!: () => void
        let active = 0
        let peak = 0
        let first = true
        const upload = cloud.upload
        cloud.upload = vi.fn(async (path, data, signal) => {
            if (path.endsWith("project.od")) {
                active++; peak = Math.max(peak, active)
                if (first) {first = false; await new Promise<void>(resolve => {release = resolve})}
                active--
            }
            await upload(path, data, signal)
        })
        const pending = CloudBackup.backupWithHandler(cloud, "Dropbox")
        const outcome = pending.then(() => "success", error => String(error))
        await vi.waitFor(() => expect(release).toBeDefined())
        await vi.advanceTimersByTimeAsync(10 * 60_000)
        const requests = vi.mocked(cloud.upload).mock.calls
        const firstUpload = requests.find(([path]) => path.endsWith("project.od"))!
        expect(firstUpload[2]?.aborted).toBe(true)
        expect(cloud.delete).not.toHaveBeenCalled()
        expect(RuntimeNotifier.approve).not.toHaveBeenCalled()
        expect(requests.filter(([path]) => path.endsWith("meta.json"))).toHaveLength(0)
        release()
        const result = await outcome
        expect(result).toContain(retry ? "success" : "Upload timeout")
        expect(peak).toBe(1)
        expect(cloud.delete).toHaveBeenCalledWith("lock.json")
        expect(vi.mocked(cloud.upload).mock.calls.filter(([path]) => path.endsWith("meta.json"))).toHaveLength(retry ? 1 : 0)
        const generations = vi.mocked(cloud.upload).mock.calls.filter(([path]) => path.endsWith("project.od")).map(([path]) => path.split("/")[3])
        expect(new Set(generations).size).toBe(retry ? 2 : 1)
        expect(vi.getTimerCount()).toBe(0)
    })
}
