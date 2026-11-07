import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox, TapeDeviceBox} from "@opendaw/studio-boxes"
import {AudioUnitType} from "@opendaw/studio-enums"
import {PresetEncoder, ProjectSkeleton} from "@opendaw/studio-adapters"
const io = vi.hoisted(() => ({read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}))
vi.mock("../Workers", () => ({Workers: {Opfs: io}}))
vi.mock("../project/Project", () => ({Project: {}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const b = "00000000-0000-4000-8000-000000000002" as UUID.String
const root = "presets/user"
const index = `${root}/index.json`
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const meta = (uuid = a) => ({uuid, name: "Synthetic", description: "", category: "audio-effect-chain" as const, created: 0, modified: 0})
let files: Map<string, Uint8Array>
beforeEach(() => {
    vi.clearAllMocks()
    files = new Map([[index, json([])]])
    io.read.mockImplementation(async path => {if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")} return files.get(path)!})
    io.write.mockImplementation(async (path, data) => {files.set(path, data.slice())})
    io.delete.mockImplementation(async path => {for (const key of files.keys()) {if (key === path || key.startsWith(`${path}/`)) {files.delete(key)}}})
    io.list.mockImplementation(async folder => [...files.keys()].filter(path => path.startsWith(`${folder}/`)).map(path => ({name: path.slice(folder.length + 1), kind: "file"})))
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (name: string, task: () => Promise<unknown>) => {
        const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task); queues.set(name, next); return next
    }}})
})
afterEach(() => vi.restoreAllMocks())
const context = async () => {vi.resetModules(); return (await import("./PresetStorage")).PresetStorage}
const tick = async () => {for (let i = 0; i < 40; i++) {await Promise.resolve()}}
for (const bad of [null, {}, {...meta(), category: "unknown"}, {...meta(), uuid: "junk"}, {...meta(), modified: null}, {...meta(), category: "instrument", device: "unknown"}]) {
    it(`rebuilds invalid index record ${JSON.stringify(bad)}`, async () => {
        files.set(index, json([bad]))
        const storage = await context()
        expect(await storage.readIndex()).toEqual([])
        await storage.save(meta(b), new ArrayBuffer(8))
        expect((await storage.readIndex()).map(value => value.uuid)).toEqual([b])
    })
}
const rack = () => {
    const skeleton = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} = skeleton
    boxGraph.beginTransaction()
    const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Instrument); box.collection.refer(rootBox.audioUnits); box.output.refer(primaryAudioBusBox.input)
    })
    TapeDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.input); box.label.setValue("Synthetic Rack")})
    boxGraph.endTransaction()
    return new Uint8Array(PresetEncoder.encode(unit))
}
it("salvages a valid physical rack from a corrupt index without changing its file", async () => {
    const bytes = rack(); files.set(`${root}/${a}.odp`, bytes); files.set(index, json([null]))
    const storage = await context()
    expect(await storage.readIndex()).toMatchObject([{uuid: a, category: "audio-unit", instrument: "Tape"}])
    expect(files.get(`${root}/${a}.odp`)).toEqual(bytes)
    expect(io.write.mock.calls.every(([path]) => path === index)).toBe(true)
})
const blockFirstIndexWrite = () => {
    const gate = Promise.withResolvers<void>()
    let blocked = false
    let count = 0
    io.write.mockImplementation(async (path, data) => {
        if (path === index && ++count === 1) {blocked = true; await gate.promise}
        files.set(path, data.slice())
    })
    return {gate, blocked: () => blocked}
}
it("serializes two host contexts and rereads committed state for concurrent saves", async () => {
    const one = await context(); const two = await context()
    await one.readIndex(); await two.readIndex()
    const block = blockFirstIndexWrite()
    const first = one.save(meta(a), new ArrayBuffer(8)); await tick()
    expect(block.blocked()).toBe(true)
    const second = two.save(meta(b), new ArrayBuffer(8))
    try {await tick(); expect(files.has(`${root}/${b}.odp`)).toBe(false)}
    finally {block.gate.resolve(); await Promise.allSettled([first, second])}
    expect(JSON.parse(new TextDecoder().decode(files.get(index))).map((value: {uuid: string}) => value.uuid).sort()).toEqual([a, b])
})
it("does not resurrect metadata when rename and remove overlap across contexts", async () => {
    files.set(index, json([meta(a)])); files.set(`${root}/${a}.odp`, new Uint8Array(8))
    const one = await context(); const two = await context()
    await one.readIndex(); await two.readIndex()
    const block = blockFirstIndexWrite()
    const rename = one.updateMeta(UUID.parse(a), {name: "Renamed", description: ""}); await tick()
    const remove = two.remove(UUID.parse(a)); await tick()
    block.gate.resolve(); await Promise.all([rename, remove])
    expect(JSON.parse(new TextDecoder().decode(files.get(index)))).toEqual([])
    expect(files.has(`${root}/${a}.odp`)).toBe(false)
})

it("accepts all supported preset variants without losing their category fields", async () => {
    const variants = [
        {...meta(), category: "instrument", device: "Tape"},
        {...meta(), category: "audio-effect", device: "Delay"},
        {...meta(), category: "midi-effect", device: "Arpeggio"},
        {...meta(), category: "audio-unit", instrument: "Tape"},
        meta(), {...meta(), category: "midi-effect-chain"}
    ]
    files.set(index, json(variants))
    expect(await (await context()).readIndex()).toEqual(variants)
    expect(io.write).not.toHaveBeenCalled()
})
it("rejects invalid incoming metadata before publishing the preset file", async () => {
    const storage = await context()
    await expect(storage.save({...meta(), created: Infinity}, new ArrayBuffer(8))).rejects.toThrow()
    expect(io.write).not.toHaveBeenCalled()
})

it("preserves valid non-rack metadata while recovering a mixed corrupt index", async () => {
    const retained = {...meta(b), category: "instrument", device: "Tape", name: "Retained Metadata"}
    files.set(index, json([retained, null])); files.set(`${root}/${a}.odp`, rack()); files.set(`${root}/${b}.odp`, new Uint8Array(8))
    const entries = await (await context()).readIndex()
    expect(entries).toContainEqual(retained)
    expect(entries).toContainEqual(expect.objectContaining({uuid: a, category: "audio-unit"}))
    expect(JSON.parse(new TextDecoder().decode(files.get(index)))).toEqual(entries)
})

it("drops missing-file metadata on explicit rebuild while preserving existing non-rack metadata", async () => {
    const retained = {...meta(b), category: "instrument", device: "Tape", name: "Retained Metadata"}
    files.set(index, json([meta(a), retained])); files.set(`${root}/${b}.odp`, new Uint8Array(8))
    expect(await (await context()).rebuildIndex()).toEqual([retained])
})
