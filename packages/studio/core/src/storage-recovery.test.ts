import {beforeEach, describe, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {WavFile} from "@opendaw/lib-dsp"
import {SamplePeaks} from "@opendaw/lib-fusion"
import {AudioFileBox, SoundfontFileBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectStorage} from "./project/ProjectStorage"
import {ProjectMeta} from "./project/ProjectMeta"
import {SampleStorage} from "./samples/SampleStorage"
import {PresetStorage} from "./presets/PresetStorage"
import {Workers} from "./Workers"

vi.mock("./Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}, Peak: {generateAsync: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const b = "00000000-0000-4000-8000-000000000002" as UUID.String
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const files = new Map<string, Uint8Array>()
const missing = () => new DOMException("missing", "NotFoundError")

beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    files.clear()
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (!files.has(path)) {throw missing()}
        return files.get(path)!
    })
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {files.set(path, data)})
    vi.mocked(Workers.Opfs.delete).mockResolvedValue()
    vi.mocked(Workers.Opfs.list).mockResolvedValue([])
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {
        request: (name: string, task: () => Promise<unknown>) => {
            const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task)
            queues.set(name, next)
            return next
        }
    }})
})

describe("deletion journal", () => {
    for (const domain of ["project", "sample"]) {
        it(`serializes separate callers in the ${domain} domain and deduplicates retries`, async () => {
            const remove = (id: UUID.String) => domain === "project"
                ? ProjectStorage.deleteProject(UUID.parse(id)) : SampleStorage.get().deleteItem(UUID.parse(id))
            await Promise.all([remove(a), remove(b), remove(a)])
            const folder = domain === "project" ? "projects/v1" : "samples/v2"
            expect(JSON.parse(new TextDecoder().decode(files.get(`${folder}/trash.json`)))).toEqual([a, b])
        })
    }
    it("retains failed deletions and another caller's journal entry", async () => {
        vi.mocked(Workers.Opfs.delete).mockRejectedValueOnce(new Error("disk"))
        await expect(ProjectStorage.deleteProject(UUID.parse(a))).rejects.toThrow("disk")
        await ProjectStorage.deleteProject(UUID.parse(b))
        expect(JSON.parse(new TextDecoder().decode(files.get("projects/v1/trash.json")))).toEqual([a, b])
    })
    it("does not replace an unreadable journal", async () => {
        vi.mocked(Workers.Opfs.read).mockRejectedValue(new DOMException("denied", "NotAllowedError"))
        await expect(ProjectStorage.deleteProject(UUID.parse(a))).rejects.toThrow("denied")
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
})

it("lists healthy projects beside invalid UUIDs, missing metadata and malformed JSON", async () => {
    vi.mocked(Workers.Opfs.list).mockResolvedValue([a, b, "invalid", "00000000-0000-4000-8000-000000000003"].map(name => ({name, kind: "directory"})))
    files.set(`projects/v1/${a}/meta.json`, json(ProjectMeta.init("Healthy")))
    files.set(`projects/v1/${b}/meta.json`, new TextEncoder().encode("{"))
    expect((await ProjectStorage.listProjects()).map(entry => entry.meta.name)).toEqual(["Healthy"])
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    vi.mocked(Workers.Opfs.list).mockRejectedValue(new Error("root denied"))
    await expect(ProjectStorage.listProjects()).rejects.toThrow("root denied")
})

for (const kind of ["missing", "empty", "corrupt", "valid", "denied", "no audio"]) {
    it(`handles ${kind} peaks without hiding required read failures`, async () => {
        const path = `samples/v2/${a}`
        const frames = new Float32Array(new SharedArrayBuffer(8))
        frames.set([0, 0.5])
        const audio = {frames: [frames], sampleRate: 44100, numberOfFrames: 2, numberOfChannels: 1}
        files.set(`${path}/audio.wav`, new Uint8Array(WavFile.encodeFloats(audio)))
        files.set(`${path}/meta.json`, json({name: "Synthetic"}))
        if (kind !== "missing") {files.set(`${path}/peaks.bin`, new Uint8Array(kind === "empty" ? [] : [kind === "valid" ? 1 : 0]))}
        if (kind === "no audio") {files.delete(`${path}/audio.wav`)}
        const peaks = {} as ReturnType<typeof SamplePeaks.from>
        vi.spyOn(SamplePeaks, "from").mockImplementation(input => {
            if (input.readByte() !== 1) {throw new Error("invalid peaks")}
            return peaks
        })
        vi.spyOn(SamplePeaks, "findBestFit").mockReturnValue(new Uint8Array([1]))
        vi.mocked(Workers.Peak.generateAsync).mockResolvedValue(new Uint8Array([1]).buffer)
        if (kind === "denied") {
            vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
                if (path.endsWith("peaks.bin")) {throw new DOMException("denied", "NotAllowedError")}
                return files.get(path)!
            })
        }
        if (["denied", "no audio"].includes(kind)) {
            await expect(SampleStorage.get().load(UUID.parse(a))).rejects.toThrow()
            expect(Workers.Peak.generateAsync).not.toHaveBeenCalled()
        } else {
            expect((await SampleStorage.get().load(UUID.parse(a)))[1]).toBe(peaks)
            expect(Workers.Peak.generateAsync).toHaveBeenCalledTimes(kind === "valid" ? 0 : 1)
        }
    })
}

for (const type of [AudioFileBox, SoundfontFileBox]) {
    it(`blocks ${type.name} deletion on incomplete project and preset scans`, async () => {
        vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: a, kind: "directory"}])
        await expect(ProjectStorage.listUsedAssets(type)).rejects.toThrow("project")
        files.set(`projects/v1/${a}/project.od`, new Uint8Array([0]))
        files.set(`projects/v1/${a}/meta.json`, json(ProjectMeta.init()))
        vi.spyOn(ProjectSkeleton, "decode").mockImplementation(() => {throw new Error("corrupt")})
        await expect(ProjectStorage.listUsedAssets(type)).rejects.toThrow("project")
        vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: `${a}.odp`, kind: "file"}])
        files.set("presets/user/index.json", json([{uuid: a, name: "Synthetic"}]))
        await expect(PresetStorage.listUsedAssets(type)).rejects.toThrow("repair preset")
        files.set(`presets/user/${a}.odp`, new Uint8Array([0]))
        await expect(PresetStorage.listUsedAssets(type)).rejects.toThrow("Invalid preset")
        files.set("presets/user/index.json", json([]))
        vi.mocked(Workers.Opfs.list).mockResolvedValue([])
        expect((await ProjectStorage.listUsedAssets(type)).size).toBe(0)
        expect((await PresetStorage.listUsedAssets(type)).size).toBe(0)
    })
}

it("keeps tolerant discovery out of backup and diagnoses non-UUID usage sources", async () => {
    vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: "invalid", kind: "directory"}])
    expect(await ProjectStorage.listProjects()).toEqual([])
    await expect(ProjectStorage.listProjects({strict: true})).rejects.toThrow("Cannot scan project 'invalid'")
    await expect(ProjectStorage.listUsedAssets(AudioFileBox)).rejects.toThrow("project 'invalid'")
})
it("does not use a missing, malformed or stale preset index to skip physical preset files", async () => {
    vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: `${a}.odp`, kind: "file"}])
    for (const index of [undefined, "{", "[]"]) {
        if (index !== undefined) {files.set("presets/user/index.json", new TextEncoder().encode(index))}
        await expect(PresetStorage.listUsedAssets(AudioFileBox)).rejects.toThrow("repair preset")
    }
})
it("stops cloud backup before writes when a corrupt local project is retained", async () => {
    const {CloudBackupProjects} = await import("./cloud/CloudBackupProjects")
    vi.mocked(Workers.Opfs.list).mockResolvedValue([{name: a, kind: "directory"}])
    const upload = vi.fn()
    const cloud = {upload, download: async () => json({[a]: ProjectMeta.init("Older cloud copy")}).buffer,
        list: vi.fn(), delete: vi.fn(), exists: vi.fn(), alive: vi.fn()}
    await expect(CloudBackupProjects.start(cloud, () => {}, () => {})).rejects.toThrow("Cannot scan project")
    expect(upload).not.toHaveBeenCalled()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
