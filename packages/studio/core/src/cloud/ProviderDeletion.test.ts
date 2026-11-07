import {afterEach, expect, it, vi} from "vitest"
import {Progress, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {DropboxHandler} from "./DropboxHandler"
import {GoogleDriveHandler} from "./GoogleDriveHandler"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {OpenPresetAPI, PresetStorage} from "../presets"

const mocks = vi.hoisted(() => ({remove: vi.fn()}))
vi.mock("dropbox", () => ({Dropbox: class {filesDeleteV2 = mocks.remove}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const notFound = {status: 409, error: {error: {".tag": "path_lookup", path_lookup: {".tag": "not_found"}}}}
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})
it("retries catalog publication after Dropbox already deleted the preset", async () => {
    const entry = {uuid: a, name: "Synthetic", created: 1, modified: 1, description: "", category: "audio-effect-chain"}
    let catalog: unknown = [entry]
    mocks.remove.mockResolvedValueOnce({}).mockRejectedValueOnce(notFound)
    vi.spyOn(PresetStorage, "readIndex").mockResolvedValue([])
    vi.spyOn(PresetStorage, "loadTrashedIds").mockResolvedValue([a])
    vi.spyOn(OpenPresetAPI, "get").mockReturnValue({list: async () => []} as unknown as ReturnType<typeof OpenPresetAPI.get>)
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(true)
    const dropbox = new DropboxHandler("synthetic")
    const upload = vi.fn().mockRejectedValueOnce(new Error("catalog failed")).mockImplementation(async (_path, bytes) => {catalog = JSON.parse(new TextDecoder().decode(bytes))})
    const cloud = {delete: dropbox.delete.bind(dropbox), download: vi.fn(async () => new TextEncoder().encode(JSON.stringify(catalog)).buffer), upload, list: vi.fn(), alive: vi.fn(), exists: vi.fn()}
    await expect(CloudBackupPresets.start(cloud, Progress.Empty, () => {})).rejects.toThrow("catalog failed")
    expect(catalog).toEqual([entry])
    await CloudBackupPresets.start(cloud, Progress.Empty, () => {})
    expect(catalog).toEqual([])
    expect(mocks.remove).toHaveBeenCalledTimes(2)
    expect(mocks.remove).toHaveBeenLastCalledWith({path: `/presets/${a}.odp`})
})
for (const error of [new Error("transport"), {status: 401, error: notFound.error}, {status: 409, error: {error: {".tag": "path_write", path_write: {".tag": "no_write_permission"}}}}, {status: 409, error: {error: {".tag": "path_lookup", path_lookup: {".tag": "restricted_content"}}}}]) {
    it("does not suppress unrelated Dropbox deletion errors", async () => {
        mocks.remove.mockRejectedValueOnce(error)
        await expect(new DropboxHandler("synthetic").delete("file")).rejects.toBe(error)
    })
}
for (const kind of ["folder", "file", "missing", "denied", "query denied"] as const) {
    it(`resolves the actual Drive deletion target: ${kind}`, async () => {
        const folderMime = "application/vnd.google-apps.folder"
        const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
            if (init?.method === "DELETE") {return new Response(null, {status: kind === "denied" ? 403 : 204})}
            const q = new URL(input).searchParams.get("q")!
            if (q.includes("name = 'projects'")) {return Response.json({files: [{id: "projects-id", mimeType: folderMime}]})}
            if (kind === "query denied") {return new Response("denied", {status: 403})}
            const excludedFolder = kind === "folder" && q.includes("mimeType !=")
            return Response.json({files: kind === "missing" || excludedFolder ? [] : [{id: "target-id", mimeType: kind === "folder" ? folderMime : "application/octet-stream"}]})
        })
        vi.stubGlobal("fetch", fetchMock)
        const drive = new GoogleDriveHandler("synthetic")
        const task = drive.delete(`projects/${a}`)
        if (kind === "denied" || kind === "query denied") {await expect(task).rejects.toThrow("403")} else {await task}
        const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")
        if (kind === "missing" || kind === "query denied") {expect(deletes).toHaveLength(0)}
        else {expect(deletes).toHaveLength(1); expect(deletes[0][0]).toBe("https://www.googleapis.com/drive/v3/files/target-id")}
        const lookup = fetchMock.mock.calls.find(([url]) => new URL(url).searchParams.get("q")?.includes(`name = '${a}'`))!
        expect(new URL(lookup[0]).searchParams.get("q")).not.toContain("mimeType !=")
    })
}
it("keeps Drive download lookup file-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({files: []}))
    vi.stubGlobal("fetch", fetchMock)
    await expect(new GoogleDriveHandler("synthetic").download("file")).rejects.toThrow()
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("q")).toContain("mimeType !=")
})
