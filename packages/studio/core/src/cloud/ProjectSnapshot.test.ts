import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Errors, Option, Progress, UUID} from "@opendaw/lib-std"
import {CloudBackupProjects} from "./CloudBackupProjects"
import {ProjectProfile} from "../project/ProjectProfile"
import {ProjectMeta} from "../project/ProjectMeta"
import {Workers} from "../Workers"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), list: vi.fn(), delete: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const root = `projects/v1/${a}`
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
let files: Map<string, Uint8Array>
let remote: Map<string, ArrayBuffer>
let oldMeta: ProjectMeta
const flush = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve()}}
beforeEach(() => {
    oldMeta = Object.assign(ProjectMeta.init("Old"), {modified: "2020-01-01T00:00:00.000Z"})
    files = new Map([[`${root}/meta.json`, json(oldMeta)], [`${root}/project.od`, new Uint8Array([1])], [`${root}/image.bin`, new Uint8Array([2])]])
    remote = new Map([["projects/index.json", json({}).buffer]])
    vi.mocked(Workers.Opfs.list).mockResolvedValue([{kind: "directory", name: a}])
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")} return files.get(path)!.slice()})
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
const profile = () => new ProjectProfile(UUID.parse(a), {
    toArrayBuffer: () => new Uint8Array([9]).buffer,
    editing: {mark: vi.fn(), markSaved: vi.fn()}
} as unknown as ConstructorParameters<typeof ProjectProfile>[1], ProjectMeta.init("New"), Option.wrap(new Uint8Array([8]).buffer), true)
const cloud = () => ({upload: vi.fn(async (path: string, bytes: ArrayBuffer) => {remote.set(path, bytes.slice(0))}),
    download: vi.fn(async (path: string) => {if (!remote.has(path)) {throw new Errors.FileNotFound(path)} return remote.get(path)!}),
    list: vi.fn(), exists: vi.fn(), delete: vi.fn(), alive: vi.fn()})
const assertRemote = (value: number, name: string, modified: string, cover: number) => {
    const catalog = JSON.parse(new TextDecoder().decode(remote.get("projects/index.json")))
    const entry = catalog[a]
    const folder = entry.generation === undefined ? `projects/${a}` : `projects/${a}/generations/${entry.generation}`
    expect(new Uint8Array(remote.get(`${folder}/project.od`)!)).toEqual(new Uint8Array([value]))
    const meta = JSON.parse(new TextDecoder().decode(remote.get(`${folder}/meta.json`)))
    expect(meta.name).toBe(name)
    expect(entry.modified).toBe(modified)
    expect(entry.modified).toBe(meta.modified)
    expect(new Uint8Array(remote.get(`${folder}/image.bin`)!)).toEqual(new Uint8Array([cover]))
}
it("holds a coherent snapshot against a save gated between metadata and project reads", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    let reads = 0
    const read = Workers.Opfs.read
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        const bytes = files.get(path)
        if (!bytes) {throw new DOMException("missing", "NotFoundError")}
        if (path.endsWith("meta.json") && ++reads === 2) {entered.resolve(); await gate.promise}
        return bytes.slice()
    })
    const backing = CloudBackupProjects.start(cloud(), Progress.Empty, () => {})
    await entered.promise
    const saving = profile().save()
    await flush()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
    gate.resolve(); await Promise.all([saving, backing])
    assertRemote(1, "Old", oldMeta.modified, 2)
    expect(files.get(`${root}/project.od`)).toEqual(new Uint8Array([9]))
    expect(read).toHaveBeenCalled()
})
it("waits for every save file before collecting the new revision", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
        if (path.endsWith("project.od")) {entered.resolve(); await gate.promise}
        files.set(path, bytes.slice())
    })
    const current = profile()
    const saving = current.save()
    await entered.promise
    const backing = CloudBackupProjects.start(cloud(), Progress.Empty, () => {})
    await flush()
    expect(Workers.Opfs.list).not.toHaveBeenCalled()
    gate.resolve(); await Promise.all([saving, backing])
    assertRemote(9, "New", current.meta.modified, 8)
})
it("keeps failed save ownership until all started writes have settled", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(Workers.Opfs.write).mockImplementation(async path => {
        if (path.endsWith("project.od")) {entered.resolve(); await gate.promise}
        if (path.endsWith("meta.json")) {throw new Error("metadata failed")}
    })
    const outcome = profile().save().then(() => "success", error => String(error))
    await entered.promise
    const nextOwner = vi.fn()
    const waiting = navigator.locks.request("opendaw:storage:projects/v1", nextOwner)
    await flush(); expect(nextOwner).not.toHaveBeenCalled()
    gate.resolve()
    expect(await outcome).toContain("metadata failed")
    await waiting; expect(nextOwner).toHaveBeenCalledOnce()
})
it("does not silently omit a cover on operational read failure", async () => {
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (path.endsWith("image.bin")) {throw new DOMException("denied", "SecurityError")}
        if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")}
        return files.get(path)!.slice()
    })
    const handler = cloud()
    await expect(CloudBackupProjects.start(handler, Progress.Empty, () => {})).rejects.toThrow("denied")
    expect(handler.upload).not.toHaveBeenCalled()
})
