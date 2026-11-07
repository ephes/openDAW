import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Errors, RuntimeNotifier} from "@opendaw/lib-std"
import {CloudBackup} from "./CloudBackup"
import {CloudBackupSamples} from "./CloudBackupSamples"
import {CloudBackupProjects} from "./CloudBackupProjects"
import {CloudBackupSoundfonts} from "./CloudBackupSoundfonts"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {CloudHandler} from "./CloudHandler"
import {CloudService} from "./CloudService"
import {GoogleDriveHandler} from "./GoogleDriveHandler"
import {DropboxHandler} from "./DropboxHandler"

const mocks = vi.hoisted(() => ({list: vi.fn(), next: vi.fn()}))
vi.mock("dropbox", () => ({Dropbox: class {filesListFolder = mocks.list; filesListFolderContinue = mocks.next}}))
vi.mock("../project", () => ({ProjectSignals: {StorageUpdated: "storage"}}))
const service = "Dropbox" as CloudService
let cloud: CloudHandler
let terminate: ReturnType<typeof vi.fn>
beforeEach(() => {
    vi.clearAllMocks()
    terminate = vi.fn()
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate, message: ""} as unknown as ReturnType<typeof RuntimeNotifier.progress>)
    for (const phase of [CloudBackupSamples, CloudBackupProjects, CloudBackupSoundfonts, CloudBackupPresets]) {
        vi.spyOn(phase, "start").mockResolvedValue(undefined)
    }
    cloud = {download: vi.fn().mockRejectedValue(new Errors.FileNotFound("lock")), upload: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined), list: vi.fn(), exists: vi.fn(), alive: vi.fn()}
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
it("preserves primary backup failure and tears down even when release fails", async () => {
    const primary = new Error("backup failed")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(CloudBackupSamples.start).mockRejectedValue(primary)
    vi.mocked(cloud.delete).mockRejectedValue(new Error("release failed"))
    await expect(CloudBackup.backupWithHandler(cloud, service)).rejects.toBe(primary)
    expect(terminate).toHaveBeenCalledTimes(1)
})
it("does not delete a lock whose upload failed", async () => {
    vi.mocked(cloud.upload).mockRejectedValue(new Error("upload failed"))
    await expect(CloudBackup.backupWithHandler(cloud, service)).rejects.toThrow("upload failed")
    expect(cloud.delete).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledTimes(1)
})
it("surfaces release failure after success and still tears down", async () => {
    vi.mocked(cloud.delete).mockRejectedValue(new Error("release failed"))
    await expect(CloudBackup.backupWithHandler(cloud, service)).rejects.toThrow("release failed")
    expect(terminate).toHaveBeenCalledTimes(1)
})
it("serializes same-browser backups and releases ownership after failure", async () => {
    let release!: () => void
    vi.mocked(CloudBackupSamples.start).mockImplementationOnce(() => new Promise<void>(resolve => {release = resolve}))
    const first = CloudBackup.backupWithHandler(cloud, service)
    await vi.waitFor(() => expect(CloudBackupSamples.start).toHaveBeenCalledTimes(1))
    const second = CloudBackup.backupWithHandler(cloud, service)
    await Promise.resolve(); await Promise.resolve()
    expect(cloud.upload).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(cloud.delete).toHaveBeenCalledTimes(2)
    vi.mocked(CloudBackupSamples.start).mockRejectedValueOnce(new Error("failed"))
    await expect(CloudBackup.backupWithHandler(cloud, service)).rejects.toThrow("failed")
    await CloudBackup.backupWithHandler(cloud, service)
})
for (const stage of ["query", "create"]) {
    it(`Drive retries after ${stage} failure and reuses a folder created before lost response`, async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        if (stage === "create") {fetchMock.mockResolvedValueOnce(Response.json({files: []}))}
        fetchMock.mockRejectedValueOnce(new Error("network"))
        const drive = new GoogleDriveHandler("synthetic")
        await expect(drive.upload("folder/file", new ArrayBuffer(0))).rejects.toThrow("network")
        fetchMock.mockResolvedValueOnce(Response.json({files: [{id: "existing"}]}))
            .mockResolvedValueOnce(Response.json({files: []})).mockResolvedValueOnce(new Response())
        await drive.upload("folder/file", new ArrayBuffer(0))
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(stage === "create" ? 2 : 1)
    })
}
it("Dropbox collects all pages and rejects a failed continuation", async () => {
    mocks.list.mockResolvedValue({result: {entries: [{name: "cover"}], cursor: "page2", has_more: true}})
    mocks.next.mockResolvedValue({result: {entries: [{name: "project.od"}, {name: "meta.json"}], has_more: false}})
    const dropbox = new DropboxHandler("synthetic")
    await expect(dropbox.list("folder")).resolves.toEqual(["cover", "project.od", "meta.json"])
    expect(mocks.next).toHaveBeenCalledWith({cursor: "page2"})
    mocks.next.mockRejectedValueOnce(new Error("page failed"))
    await expect(dropbox.list("folder")).rejects.toThrow("page failed")
})
