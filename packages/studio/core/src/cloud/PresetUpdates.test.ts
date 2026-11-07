import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Progress, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {OpenPresetAPI, PresetStorage} from "../presets"
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const meta = (modified: number, name = "Synthetic") => ({uuid: a, name, modified, created: 0, description: "", category: "audio-effect-chain" as const})
beforeEach(() => {
    vi.spyOn(OpenPresetAPI, "get").mockReturnValue({list: async () => []} as unknown as ReturnType<typeof OpenPresetAPI.get>)
    vi.spyOn(PresetStorage, "loadTrashedIds").mockResolvedValue([])
    vi.spyOn(PresetStorage, "load").mockResolvedValue(new Uint8Array([9]).buffer)
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
for (const modified of [0, 1, 2]) {
    it(`uploads an edited preset only for a newer local timestamp (${modified} vs 1)`, async () => {
        vi.spyOn(PresetStorage, "readIndex").mockResolvedValue([meta(modified, "Edited")])
        const remote = new Map([["presets/index.json", new TextEncoder().encode(JSON.stringify([meta(1)])).buffer]])
        const handler = {download: vi.fn(async (path: string) => remote.get(path)!), upload: vi.fn(async (path: string, bytes: ArrayBuffer) => {remote.set(path, bytes)}), delete: vi.fn(), list: vi.fn(), alive: vi.fn(), exists: vi.fn()}
        await CloudBackupPresets.start(handler, Progress.Empty, () => {})
        expect(handler.upload).toHaveBeenCalledTimes(modified > 1 ? 2 : 0)
        const catalog = JSON.parse(new TextDecoder().decode(remote.get("presets/index.json")))
        expect(catalog).toEqual([meta(modified > 1 ? modified : 1, modified > 1 ? "Edited" : "Synthetic")])
        if (modified > 1) {expect(new Uint8Array(remote.get(`presets/${a}.odp`)!)).toEqual(new Uint8Array([9]))}
    })
}
it("leaves prior preset catalog metadata when the edited bytes fail to upload", async () => {
    vi.spyOn(PresetStorage, "readIndex").mockResolvedValue([meta(2, "Edited")])
    const upload = vi.fn().mockRejectedValue(new Error("upload failed"))
    const handler = {download: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify([meta(1)])).buffer), upload, delete: vi.fn(), list: vi.fn(), alive: vi.fn(), exists: vi.fn()}
    await expect(CloudBackupPresets.start(handler, Progress.Empty, () => {})).rejects.toThrow("upload failed")
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe(`presets/${a}.odp`)
})
it("still excludes stock UUIDs even when the local modification is newer", async () => {
    vi.spyOn(PresetStorage, "readIndex").mockResolvedValue([meta(2)])
    vi.mocked(OpenPresetAPI.get).mockReturnValue({list: async () => [meta(0)]} as unknown as ReturnType<typeof OpenPresetAPI.get>)
    const handler = {download: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify([meta(1)])).buffer), upload: vi.fn(), delete: vi.fn(), list: vi.fn(), alive: vi.fn(), exists: vi.fn()}
    await CloudBackupPresets.start(handler, Progress.Empty, () => {})
    expect(handler.upload).not.toHaveBeenCalled()
})
for (const failure of ["later preset", "catalog"] as const) {
    it(`documents and repairs partial existing-preset updates after ${failure} failure`, async () => {
        const b = "00000000-0000-4000-8000-000000000002" as UUID.String
        const old = [meta(1), {...meta(1), uuid: b}]
        const edited = [meta(2, "Edited first"), {...meta(2, "Edited second"), uuid: b}]
        vi.spyOn(PresetStorage, "readIndex").mockResolvedValue(edited)
        const remote = new Map([["presets/index.json", new TextEncoder().encode(JSON.stringify(old)).buffer], [`presets/${a}.odp`, new Uint8Array([1]).buffer]])
        let fail = true
        const handler = {download: vi.fn(async (path: string) => remote.get(path)!),
            upload: vi.fn(async (path: string, bytes: ArrayBuffer) => {
                if (fail && path === (failure === "catalog" ? "presets/index.json" : `presets/${b}.odp`)) {throw new Error("partial update")}
                remote.set(path, bytes)
            }), delete: vi.fn(), list: vi.fn(), alive: vi.fn(), exists: vi.fn()}
        await expect(CloudBackupPresets.start(handler, Progress.Empty, () => {})).rejects.toThrow("partial update")
        // Presets use in-place files: this is explicitly not a multi-file transaction.
        expect(new Uint8Array(remote.get(`presets/${a}.odp`)!)).toEqual(new Uint8Array([9]))
        expect(JSON.parse(new TextDecoder().decode(remote.get("presets/index.json")))).toEqual(old)
        fail = false
        await CloudBackupPresets.start(handler, Progress.Empty, () => {})
        expect(JSON.parse(new TextDecoder().decode(remote.get("presets/index.json")))).toEqual(edited)
    })
}
