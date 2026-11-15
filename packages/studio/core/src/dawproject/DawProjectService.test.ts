import {beforeEach, expect, it, vi} from "vitest"
import {Files} from "@opendaw/lib-dom"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {SamplePeaks} from "@opendaw/lib-fusion"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"
import {Xml} from "@opendaw/lib-xml"
import {ApplicationSchema, MetaDataSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {DawProject} from "./DawProject"
import {DawProjectImport} from "./DawProjectImporter"
import {DawProjectService} from "./DawProjectService"
import {SampleService} from "../samples/SampleService"
import {SampleStorage} from "../samples/SampleStorage"
import {Workers} from "../Workers"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn(), exists: vi.fn()}, Peak: {generateAsync: vi.fn()}}}))
vi.mock("./DawProject", () => ({DawProject: {decode: vi.fn()}}))
vi.mock("./DawProjectImporter", () => ({DawProjectImport: {read: vi.fn()}}))
const files = new Map<string, Uint8Array>()
const service = new SampleService({decodeAudioData: async () => {throw new Error("synthetic decoder failure")}} as unknown as AudioContext)
const peaks = new SamplePeaks([], [new Int32Array(0)], 2, 1).toArrayBuffer() as ArrayBuffer
const sample = (value: number) => {
    const audio = AudioData.create(44100, 2, 1)
    audio.frames[0].fill(value)
    return {uuid: UUID.generate(), path: "synthetic.wav", name: "Synthetic", buffer: WavFile.encodeFloats(audio)}
}
const setup = (resources: DawProject.Resource[]) => {
    vi.mocked(DawProject.decode).mockResolvedValue({project: Xml.element({version: "1.0", application: Xml.element({name: "Synthetic"}, ApplicationSchema), structure: []}, ProjectSchema), metaData: Xml.element({}, MetaDataSchema), resources: {
        fromUUID: uuid => resources.find(resource => UUID.equals(uuid, resource.uuid))!, fromPath: () => resources[0]
    }})
    const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    vi.mocked(DawProjectImport.read).mockResolvedValue({skeleton, audioIds: resources.map(resource => resource.uuid)})
    return skeleton
}
beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    files.clear()
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (name: string, task: () => Promise<unknown>) => {
        const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(name, next)
        return next
    }}})
    vi.spyOn(Files, "open").mockResolvedValue([{size: 1, arrayBuffer: async () => new ArrayBuffer(1)} as File])
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")}
        return files.get(path)!
    })
    vi.mocked(Workers.Opfs.exists).mockImplementation(async path => [...files.keys()].some(file => file.startsWith(path)))
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {files.set(path, data)})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {
        for (const file of files.keys()) {if (file === path || file.startsWith(`${path}/`)) {files.delete(file)}}
    })
    vi.mocked(Workers.Opfs.list).mockImplementation(async () => [...new Set([...files.keys()].map(path => path.split("/")[2]))]
        .map(name => ({name, kind: "directory" as const})))
    vi.mocked(Workers.Peak.generateAsync).mockResolvedValue(peaks)
})
it("refuses oversized compressed input before reading it", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1))
    vi.mocked(Files.open).mockResolvedValue([{size: 536_870_913, arrayBuffer} as unknown as File])
    await expect(DawProjectService.importDawproject(service)).rejects.toThrow(/compressed.*limit/i)
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(DawProject.decode).not.toHaveBeenCalled()
})
it("bounds active sample decoders while importing many resources", async () => {
    const skeleton = setup(Array.from({length: 9}, (_, index) => sample(index / 16)))
    let active = 0, maximum = 0
    vi.mocked(Workers.Peak.generateAsync).mockImplementation(async () => {
        maximum = Math.max(maximum, ++active)
        await new Promise(resolve => setTimeout(resolve, 1))
        active--
        return peaks
    })
    expect((await DawProjectService.importDawproject(service)).unwrap()).toBe(skeleton)
    expect(maximum).toBeLessThanOrEqual(2)
    expect((await SampleStorage.get().list()).length).toBe(9)
})
it("unwinds new assets after a sibling fails, preserves preexisting data, and permits retry", async () => {
    const existing = sample(0.25), fresh = sample(0.5), failing = sample(0.75)
    await service.importFile({uuid: existing.uuid, name: existing.name, arrayBuffer: existing.buffer})
    const before = new Map(files)
    setup([existing, fresh, failing])
    const failedPath = `${SampleStorage.Folder}/${UUID.toString(failing.uuid)}/meta.json`
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {
        files.set(path, data)
        if (path === failedPath) {throw new Error("synthetic disk failure")}
    })
    await expect(DawProjectService.importDawproject(service)).rejects.toThrow("synthetic disk failure")
    expect(files).toEqual(before)
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {files.set(path, data)})
    expect((await DawProjectService.importDawproject(service)).nonEmpty()).toBe(true)
    expect(await SampleStorage.get().list()).toHaveLength(3)
})
it("keeps the primary import error even if compensation fails", async () => {
    const fresh = sample(0.25), failing = sample(0.5)
    setup([fresh, failing])
    const failedPath = `${SampleStorage.Folder}/${UUID.toString(failing.uuid)}/meta.json`
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, data) => {
        files.set(path, data)
        if (path === failedPath) {
            await new Promise(resolve => setTimeout(resolve, 10))
            throw new Error("primary failure")
        }
    })
    vi.mocked(Workers.Opfs.delete).mockRejectedValue(new Error("cleanup failure"))
    await expect(DawProjectService.importDawproject(service)).rejects.toThrow("primary failure")
    expect(Workers.Opfs.delete).toHaveBeenCalledWith(`${SampleStorage.Folder}/${UUID.toString(fresh.uuid)}`)
})
