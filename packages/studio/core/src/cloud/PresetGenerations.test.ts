import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Progress, UUID} from "@opendaw/lib-std"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {OpenPresetAPI, PresetStorage} from "../presets"
const io = vi.hoisted(() => ({read: vi.fn(), write: vi.fn(), exists: vi.fn(), list: vi.fn()}))
vi.mock("../Workers", () => ({Workers: {Opfs: io}}))
vi.mock("../project/Project", () => ({Project: {}}))
const id = "00000000-0000-4000-8000-000000000001" as UUID.String
const index = "presets/user/index.json"
const file = `presets/user/${id}.odp`
const remoteFile = `presets/${id}.odp`
const meta = (modified: number, name = "Synthetic") => ({uuid: id, name, modified, created: 0, description: "", category: "audio-effect-chain" as const})
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
let files: Map<string, Uint8Array>
beforeEach(() => {
    files = new Map([[index, json([])]])
    io.read.mockImplementation(async path => {if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")} return files.get(path)!.slice()})
    io.write.mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    io.exists.mockImplementation(async path => files.has(path))
    io.list.mockResolvedValue([])
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (name: string, task: () => Promise<unknown>) => {
        const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(name, next); return next
    }}})
    vi.spyOn(OpenPresetAPI, "get").mockReturnValue({list: async () => []} as unknown as ReturnType<typeof OpenPresetAPI.get>)
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
const handler = (remote: ReturnType<typeof meta>[]) => ({download: vi.fn(async (_path: string) => json(remote).buffer), upload: vi.fn(async (_path: string, _bytes: ArrayBuffer) => {}), delete: vi.fn(), list: vi.fn(), alive: vi.fn(), exists: vi.fn()})
it("preserves a local generation created while cloud restore is downloading", async () => {
    const cloud = handler([meta(1, "Remote")])
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>()
    cloud.download.mockImplementation(async path => {
        if (path === remoteFile) {entered.resolve(); await release.promise; return new Uint8Array([1]).buffer}
        return json([meta(1, "Remote")]).buffer
    })
    const log = vi.fn()
    const backup = CloudBackupPresets.start(cloud, Progress.Empty, log)
    await entered.promise
    await PresetStorage.save(meta(2, "Local"), new Uint8Array([2]).buffer)
    const local = await PresetStorage.readIndex()
    release.resolve(); await backup
    expect(files.get(file)).toEqual(new Uint8Array([2]))
    expect(await PresetStorage.readIndex()).toEqual(local)
    expect(log.mock.calls.flat().join(" ")).toMatch(/Skipping.*local/)
})
for (const remoteModified of [0, 2, 4]) {
    it(`captures metadata and bytes together and rechecks eligibility (${remoteModified})`, async () => {
        files.set(index, json([meta(1, "Inventory")])); files.set(file, new Uint8Array([1]))
        const read = PresetStorage.readIndex
        vi.spyOn(PresetStorage, "readIndex").mockImplementationOnce(async () => {
            const early = await read()
            await PresetStorage.save(meta(3, "Captured"), new Uint8Array([3]).buffer)
            return early
        })
        // Stable timestamps make the before/after generation comparison deterministic.
        vi.spyOn(Date, "now").mockReturnValue(3)
        const cloud = handler([meta(remoteModified)])
        await CloudBackupPresets.start(cloud, Progress.Empty, () => {})
        if (remoteModified < 3) {
            expect(cloud.upload.mock.calls[0]).toEqual([remoteFile, new Uint8Array([3]).buffer])
            expect(JSON.parse(new TextDecoder().decode(cloud.upload.mock.calls[1][1]))).toEqual([meta(3, "Captured")])
        } else {expect(cloud.upload).not.toHaveBeenCalled()}
    })
}
it("does not restore over a physical preset omitted from the index", async () => {
    files.set(file, new Uint8Array([9]))
    const cloud = handler([meta(1)])
    cloud.download.mockImplementation(async path => path === remoteFile ? new Uint8Array([1]).buffer : json([meta(1)]).buffer)
    await CloudBackupPresets.start(cloud, Progress.Empty, () => {})
    expect(files.get(file)).toEqual(new Uint8Array([9]))
})
it("keeps edits during upload eligible for a later backup and holds no network lock", async () => {
    files.set(index, json([meta(2, "Captured")])); files.set(file, new Uint8Array([2]))
    vi.spyOn(Date, "now").mockReturnValue(3)
    const remote = new Map([["presets/index.json", json([meta(1)]).buffer]])
    const cloud = handler([])
    cloud.download.mockImplementation(async path => remote.get(path)!)
    let edit = true
    cloud.upload.mockImplementation(async (path, bytes) => {
        if (path === remoteFile && edit) {
            edit = false
            await PresetStorage.save(meta(3, "Later"), new Uint8Array([3]).buffer)
        }
        remote.set(path, bytes)
    })
    await CloudBackupPresets.start(cloud, Progress.Empty, () => {})
    expect(new Uint8Array(remote.get(remoteFile)!)).toEqual(new Uint8Array([2]))
    expect(JSON.parse(new TextDecoder().decode(remote.get("presets/index.json")))).toEqual([meta(2, "Captured")])
    await CloudBackupPresets.start(cloud, Progress.Empty, () => {})
    expect(new Uint8Array(remote.get(remoteFile)!)).toEqual(new Uint8Array([3]))
    expect(JSON.parse(new TextDecoder().decode(remote.get("presets/index.json")))).toEqual([meta(3, "Later")])
})
