import {afterEach, beforeEach, expect, it, vi} from "vitest"
import JSZip from "jszip"
import {UUID} from "@opendaw/lib-std"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {SamplePeaks} from "@opendaw/lib-fusion"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectBundle} from "./ProjectBundle"
import {Project} from "./Project"
import {ProjectMigration} from "./ProjectMigration"
import {ProjectMeta} from "./ProjectMeta"
import {ProjectEnv} from "./ProjectEnv"
import {Workers} from "../Workers"
const mock = vi.hoisted(() => ({construct: vi.fn()}))
vi.mock("./Project", () => ({Project: {
    fromSkeleton: mock.construct,
    loadAnyVersion: vi.fn(async (env: ProjectEnv, bytes: ArrayBuffer) => {
        const {ProjectSkeleton} = await import("@opendaw/studio-adapters")
        const {ProjectMigration} = await import("./ProjectMigration")
        const skeleton = ProjectSkeleton.decode(bytes)
        await ProjectMigration.migrate(env, skeleton)
        return mock.construct(env, skeleton)
    })
}}))
vi.mock("./ProjectMigration", () => ({ProjectMigration: {migrate: vi.fn()}}))
vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), list: vi.fn(), delete: vi.fn()}}}))
const sampleId = "00000000-0000-4000-8000-000000000001"
const fontId = "00000000-0000-4000-8000-000000000002"
const newId = "00000000-0000-4000-8000-000000000003"
const projectId = UUID.parse("00000000-0000-4000-8000-000000000004")
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
// Generated 408-byte empty RIFF/sfbk: INFO, sdta and terminal pdta records.
const sf2 = () => Uint8Array.from(atob("UklGRpABAABzZmJrTElTVDIAAABJTkZPaWZpbAQAAAACAAEAaXNuZwgAAABFTVU4MDAwAElOQU0KAAAAU3ludGhldGljAExJU1RoAAAAc2R0YXNtcGxcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMSVNU2gAAAHBkdGFwaGRyJgAAAEVPUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcGJhZwQAAAAAAAAAcG1vZAoAAAAAAAAAAAAAAAAAcGdlbgQAAAAAAAAAaW5zdBYAAABFT0kAAAAAAAAAAAAAAAAAAAAAAAAAaWJhZwQAAAAAAAAAaW1vZAoAAAAAAAAAAAAAAAAAaWdlbgQAAAAAAAAAc2hkci4AAABFT1MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), value => value.charCodeAt(0))
let files: Map<string, Uint8Array>
let env: ProjectEnv
beforeEach(() => {
    vi.clearAllMocks()
    files = new Map()
    mock.construct.mockReturnValue({terminate: vi.fn()})
    vi.mocked(ProjectMigration.migrate).mockResolvedValue(undefined)
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {const bytes = files.get(path); if (!bytes) {throw new DOMException("missing", "NotFoundError")} return bytes})
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {for (const key of files.keys()) {if (key === path || key.startsWith(`${path}/`)) {files.delete(key)}}})
    vi.mocked(Workers.Opfs.list).mockImplementation(async folder => [...new Set([...files.keys()].filter(path => path.startsWith(`${folder}/`)).map(path => path.slice(folder.length + 1).split("/")[0]))].map(name => ({name, kind: "directory"})))
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (name: string, task: () => Promise<unknown>) => {
        const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task); queues.set(name, next); return next
    }}})
    env = {sampleManager: {getOrCreate: vi.fn(() => {throw new Error("unstaged sample lookup")}), register: vi.fn(), remove: vi.fn(), invalidate: vi.fn(), record: vi.fn()}} as unknown as ProjectEnv
})
afterEach(() => vi.restoreAllMocks())
const archive = async (options: {sample?: string, amplitude?: number, fontVariant?: boolean} = {}) => {
    const id = options.sample ?? sampleId
    const audio = AudioData.create(44100, 2, 1); audio.frames[0].fill(options.amplitude ?? 0.25)
    const font = sf2(); if (options.fontVariant) {font[60] = 84} // Valid alternate INAM text.
    const skeleton = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    return new JSZip().file("version", "1").file("uuid", projectId)
        .file("project.od", ProjectSkeleton.encode(skeleton.boxGraph) as ArrayBuffer).file("meta.json", JSON.stringify(ProjectMeta.init("Synthetic Bundle")))
        .file(`samples/${id}/audio.wav`, WavFile.encodeFloats(audio))
        .file(`samples/${id}/peaks.bin`, new SamplePeaks([], [new Int32Array(0)], 2, 1).toArrayBuffer() as ArrayBuffer)
        .file(`samples/${id}/meta.json`, JSON.stringify({name: "Synthetic", bpm: 120, duration: 2 / 44100, sample_rate: 44100, origin: "import"}))
        .file(`soundfonts/${fontId}/soundfont.sf2`, font)
        .file(`soundfonts/${fontId}/meta.json`, JSON.stringify({name: "Synthetic", size: font.length, url: "", license: "synthetic", origin: "import"}))
}
const decode = async (zip: JSZip) => ProjectBundle.decode(env, await zip.generateAsync({type: "arraybuffer", compression: "DEFLATE"}))
for (const fault of ["missing project", "JSON", "metadata shape", "binary project"]) {
    it(`preflights ${fault} before any library write`, async () => {
        const zip = await archive()
        if (fault === "missing project") {zip.remove("project.od")}
        if (fault === "JSON") {zip.file("meta.json", "{")}
        if (fault === "metadata shape") {zip.file("meta.json", "[]")}
        if (fault === "binary project") {zip.file("project.od", new Uint8Array([1, 2, 3, 4]))}
        await expect(decode(zip)).rejects.toThrow()
        expect(Workers.Opfs.write).not.toHaveBeenCalled(); expect(files.size).toBe(0)
    })
}
it("migrates using staged real audio/peaks before publication and opens a valid bundle", async () => {
    vi.mocked(ProjectMigration.migrate).mockImplementation(async staged => {
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
        const sample = staged.sampleManager.getOrCreate(UUID.parse(sampleId))
        expect(sample.state.type).toBe("loaded"); expect(sample.data.unwrap().frames[0][0]).toBe(0.25)
    })
    const profile = await decode(await archive())
    expect(profile.uuid).toEqual(projectId)
    expect(Project.fromSkeleton).toHaveBeenCalledTimes(1)
    expect(files.size).toBe(5)
})
for (const kind of ["audio", "soundfont"]) {
    it(`preserves an existing complete ${kind} when another bundle conflicts`, async () => {
        await decode(await archive())
        const before = new Map(files)
        vi.mocked(Workers.Opfs.write).mockClear()
        await expect(decode(await archive(kind === "audio" ? {amplitude: 0.5} : {fontVariant: true}))).rejects.toThrow(/conflict/i)
        expect(files).toEqual(before); expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
}
it("deduplicates matching media and preserves local metadata", async () => {
    const zip = await archive(); await decode(zip)
    const path = `samples/v2/${sampleId}/meta.json`
    const local = JSON.parse(new TextDecoder().decode(files.get(path))); local.name = "Local Rename"; files.set(path, json(local))
    const before = new Map(files); vi.mocked(Workers.Opfs.write).mockClear()
    await decode(zip)
    expect(files).toEqual(before); expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
it("rejects incomplete existing assets instead of overwriting them", async () => {
    const zip = await archive(); const bytes = await zip.file(`samples/${sampleId}/audio.wav`)!.async("uint8array")
    files.set(`samples/v2/${sampleId}/audio.wav`, bytes)
    await expect(decode(zip)).rejects.toThrow()
    expect(Workers.Opfs.write).not.toHaveBeenCalled(); expect(files.size).toBe(1)
})
it("compensates only newly owned assets after construction failure", async () => {
    await decode(await archive()); const before = new Map(files)
    const primary = new Error("synthetic construction")
    mock.construct.mockImplementationOnce(() => {throw primary})
    await expect(decode(await archive({sample: newId}))).rejects.toBe(primary)
    expect(files).toEqual(before)
    expect(Workers.Opfs.delete).toHaveBeenCalledExactlyOnceWith(`samples/v2/${newId}`)
})
it("removes partial owned writes on publication failure", async () => {
    const primary = new Error("synthetic write")
    const write = vi.mocked(Workers.Opfs.write).getMockImplementation()!
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {await write(path, bytes); if (path.endsWith("meta.json")) {throw primary}})
    await expect(decode(await archive())).rejects.toBe(primary)
    expect(files.size).toBe(0)
})
for (const bad of [`samples/${sampleId}/unexpected.bin`, `samples/../${sampleId}/audio.wav`, `samples/00000000-0000-4000-8000-0000000000AB/audio.wav`]) {
    it(`rejects noncanonical asset entry ${bad}`, async () => {
        const zip = await archive(); zip.file(bad, new Uint8Array([1]))
        await expect(decode(zip)).rejects.toThrow()
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
}
it("preserves the primary failure and attempts cleanup of every new owned folder", async () => {
    const primary = new Error("synthetic construction")
    mock.construct.mockImplementationOnce(() => {throw primary})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(Workers.Opfs.delete).mockRejectedValueOnce(new Error("synthetic cleanup failure"))
    await expect(decode(await archive())).rejects.toBe(primary)
    expect(Workers.Opfs.delete).toHaveBeenCalledTimes(2)
    expect(files.has(`samples/v2/${sampleId}/meta.json`)).toBe(false)
})
it("shares the soundfont storage lock with ordinary library saves", async () => {
    const {SoundfontStorage} = await import("../soundfont/SoundfontStorage")
    const started = Promise.withResolvers<void>(); const gate = Promise.withResolvers<void>()
    const write = vi.mocked(Workers.Opfs.write).getMockImplementation()!
    let first = true
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
        if (first) {first = false; started.resolve(); await gate.promise}
        await write(path, bytes)
    })
    const importing = decode(await archive())
    const outcome = importing.catch(error => error)
    await started.promise
    const saving = SoundfontStorage.get().save({uuid: UUID.parse(newId), file: sf2().buffer as ArrayBuffer,
        meta: {name: "Synthetic", size: 408, url: "", license: "synthetic", origin: "import"}})
    try {
        for (let i = 0; i < 30; i++) {await Promise.resolve()}
        expect(Workers.Opfs.write).not.toHaveBeenCalledWith(`soundfont/${newId}/soundfont.sf2`, expect.anything())
    } finally {gate.resolve(); await Promise.allSettled([outcome, saving])}
    await expect(outcome).resolves.toHaveProperty("uuid")
    await saving
})

for (const path of [`samples/${sampleId}/audio.wav`, `samples/${sampleId}/peaks.bin`, `samples/${sampleId}/meta.json`, `soundfonts/${fontId}/soundfont.sf2`, `soundfonts/${fontId}/meta.json`]) {
    it(`rejects malformed staged asset ${path} before any write`, async () => {
        const zip = await archive(); zip.file(path, path.endsWith("meta.json") ? "[]" : new Uint8Array(0))
        await expect(decode(zip)).rejects.toThrow()
        expect(Workers.Opfs.write).not.toHaveBeenCalled(); expect(files.size).toBe(0)
    })
}

for (const path of [`samples/${sampleId}/meta.json`, `soundfonts/${fontId}/meta.json`]) {
    it(`rejects an asset metadata identity redirect at ${path}`, async () => {
        const zip = await archive(); const meta = JSON.parse(await zip.file(path)!.async("string"))
        zip.file(path, JSON.stringify({...meta, uuid: newId}))
        await expect(decode(zip)).rejects.toThrow(/UUID/)
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
}

it("rejects missing migration samples without starting a global loader or cache write", async () => {
    const zip = await archive(); zip.remove(`samples/${sampleId}/`)
    const get = vi.mocked(env.sampleManager.getOrCreate).mockImplementation(() => {
        void Workers.Opfs.write(`samples/v2/${newId}/meta.json`, json({name: "unowned cache write"}))
        throw new Error("global fetch started")
    })
    vi.mocked(ProjectMigration.migrate).mockImplementation(async staged => {staged.sampleManager.getOrCreate(UUID.parse(sampleId))})
    await expect(decode(zip)).rejects.toThrow("Missing bundled sample required for migration")
    expect(get).not.toHaveBeenCalled(); expect(Workers.Opfs.write).not.toHaveBeenCalled()
})

it("preserves supported string timestamp metadata without requiring a new ISO-only format", async () => {
    const zip = await archive(); zip.file("meta.json", JSON.stringify(Object.assign({}, ProjectMeta.init("Synthetic"), {created: "legacy timestamp", modified: "legacy timestamp"})))
    expect((await decode(zip)).meta.created).toBe("legacy timestamp")
})

it("rejects same-source UUID media re-encoded at another sample rate without replacing the local sample", async () => {
    await decode(await archive()); const before = new Map(files)
    const zip = await archive(); const audio = AudioData.create(48000, 2, 1); audio.frames[0].fill(0.25)
    zip.file(`samples/${sampleId}/audio.wav`, WavFile.encodeFloats(audio))
    zip.file(`samples/${sampleId}/meta.json`, JSON.stringify({name: "Synthetic", bpm: 120, duration: 2 / 48000, sample_rate: 48000, origin: "import"}))
    vi.mocked(Workers.Opfs.write).mockClear()
    await expect(decode(zip)).rejects.toThrow(/conflict/i)
    expect(files).toEqual(before); expect(Workers.Opfs.write).not.toHaveBeenCalled()
})
for (const fault of ["missing peaks", "corrupt peaks", "invalid metadata"]) {
    it(`preserves ${fault} until explicit repair and then accepts matching complete media`, async () => {
        const zip = await archive(); await decode(zip)
        const path = `samples/v2/${sampleId}/${fault === "invalid metadata" ? "meta.json" : "peaks.bin"}`
        const good = files.get(path)!
        if (fault === "missing peaks") {files.delete(path)} else {files.set(path, fault === "corrupt peaks" ? new Uint8Array(0) : json([]))}
        const damaged = new Map(files); vi.mocked(Workers.Opfs.write).mockClear()
        await expect(decode(zip)).rejects.toThrow(/repair/i)
        expect(files).toEqual(damaged); expect(Workers.Opfs.write).not.toHaveBeenCalled()
        // Explicit external repair, before retrying import; import does not own it.
        files.set(path, good); vi.mocked(Workers.Opfs.write).mockClear()
        await decode(zip)
        expect(Workers.Opfs.write).not.toHaveBeenCalled()
    })
}
