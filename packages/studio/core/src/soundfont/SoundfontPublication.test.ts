import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {SoundfontStorage} from "./SoundfontStorage"
import {syntheticSoundfont} from "./syntheticSoundfont.test-fixture"
import {Wait} from "@opendaw/lib-runtime"
import {DefaultSoundfontLoader} from "./DefaultSoundfontLoader"
import {SoundfontService} from "./SoundfontService"
import {OpenSoundfontAPI} from "./OpenSoundfontAPI"
import {Workers} from "../Workers"
vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}}}))
const a = "00000000-0000-4000-8000-000000000001" as UUID.String
const root = `soundfont/${a}`
let files: Map<string, Uint8Array>
const font = (name = "Synthetic"): SoundfontStorage.NewSoundfont => ({uuid: UUID.parse(a), file: syntheticSoundfont().buffer as ArrayBuffer,
    meta: {name, size: syntheticSoundfont().byteLength, url: "", license: "synthetic", origin: "import"}})
beforeEach(() => {
    files = new Map()
    vi.mocked(Workers.Opfs.list).mockImplementation(async folder => [...new Set([...files.keys()].filter(path => path.startsWith(`${folder}/`)).map(path => path.slice(folder.length + 1).split("/")[0]))].map(name => ({name, kind: "directory"})))
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")} return files.get(path)!})
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {for (const key of files.keys()) {if (key === path || key.startsWith(`${path}/`)) {files.delete(key)}}})
    const queues = new Map<string, Promise<unknown>>()
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (key: string, task: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
        queues.set(key, next)
        return next
    }}})
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
for (const file of ["soundfont.sf2", "meta.json"]) {
    it(`cleans only newly owned output after partial ${file} failure and permits retry`, async () => {
        vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
            files.set(path, bytes.slice())
            if (path.endsWith(file)) {throw new Error("disk full")}
        })
        await expect(SoundfontStorage.get().save(font())).rejects.toThrow("disk full")
        expect(files.size).toBe(0)
        expect(await SoundfontStorage.get().list()).toEqual([])
        vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
        await SoundfontStorage.get().save(font())
        expect(vi.mocked(Workers.Opfs.write).mock.calls.at(-1)![0]).toBe(`${root}/meta.json`)
        expect(new Uint8Array((await SoundfontStorage.get().load(UUID.parse(a)))[0])).toEqual(syntheticSoundfont())
    })
}
it("does not start metadata while SF2 is pending or after it rejects", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
        if (path.endsWith("soundfont.sf2")) {entered.resolve(); await gate.promise}
        files.set(path, bytes.slice())
    })
    const saving = SoundfontStorage.get().save(font())
    const failure = expect(saving).rejects.toThrow("media failed")
    await entered.promise
    expect(vi.mocked(Workers.Opfs.write).mock.calls.some(([path]) => path.endsWith("meta.json"))).toBe(false)
    expect(files.has(`${root}/meta.json`)).toBe(false)
    gate.reject(new Error("media failed")); await failure
    expect(files.size).toBe(0)
})
it("serializes same-UUID saves and preserves a loadable complete existing soundfont", async () => {
    await Promise.all([SoundfontStorage.get().save(font("First")), SoundfontStorage.get().save(font("Second"))])
    expect(Workers.Opfs.write).toHaveBeenCalledTimes(2)
    vi.mocked(Workers.Opfs.write).mockRejectedValue(new Error("must not overwrite"))
    await SoundfontStorage.get().save(font("Third"))
    expect(JSON.parse(new TextDecoder().decode(files.get(`${root}/meta.json`))).name).toBe("First")
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
})
for (const kind of ["missing metadata", "invalid media", "invalid metadata"]) {
    it(`repairs existing incomplete output (${kind}) from fresh validated input`, async () => {
        files.set(`${root}/soundfont.sf2`, kind === "invalid media" ? new Uint8Array([1]) : syntheticSoundfont())
        if (kind !== "missing metadata") {files.set(`${root}/meta.json`, new TextEncoder().encode(JSON.stringify(kind === "invalid metadata" ? null : font().meta)))}
        await SoundfontStorage.get().save(font())
        expect(files.get(`${root}/soundfont.sf2`)).toEqual(syntheticSoundfont())
        expect(JSON.parse(new TextDecoder().decode(files.get(`${root}/meta.json`)))).toEqual(font().meta)
        expect(Workers.Opfs.delete).toHaveBeenCalledWith(`${root}/meta.json`)
        expect(Workers.Opfs.delete).not.toHaveBeenCalledWith(root)
    })
}
it("rejects a malformed new SF2 before publishing bytes or metadata", async () => {
    await expect(SoundfontStorage.get().save({...font(), file: new ArrayBuffer(1)})).rejects.toThrow()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
})
it("cleans a failed writer before a queued writer can own the same directory", async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    let first = true
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
        if (path.endsWith("soundfont.sf2") && first) {first = false; files.set(path, bytes); entered.resolve(); await gate.promise}
        files.set(path, bytes.slice())
    })
    const one = SoundfontStorage.get().save(font("First"))
    await entered.promise
    const two = SoundfontStorage.get().save(font("Second"))
    const outcomes = Promise.allSettled([one, two])
    gate.reject(new Error("first failed"))
    expect((await outcomes).map(result => result.status)).toEqual(["rejected", "fulfilled"])
    expect(JSON.parse(new TextDecoder().decode(files.get(`${root}/meta.json`))).name).toBe("Second")
    expect(Workers.Opfs.delete).toHaveBeenCalledTimes(1)
})

it("refuses repair on operational reads or invalid fresh input", async () => {
    files.set(`${root}/soundfont.sf2`, new Uint8Array([1]))
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (path.endsWith("soundfont.sf2")) {throw new DOMException("denied", "SecurityError")}
        throw new DOMException("missing", "NotFoundError")
    })
    await expect(SoundfontStorage.get().save(font())).rejects.toThrow("denied")
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    vi.mocked(Workers.Opfs.read).mockRejectedValue(new DOMException("missing", "NotFoundError"))
    await expect(SoundfontStorage.get().save({...font(), file: new ArrayBuffer(1)})).rejects.toThrow()
    expect(Workers.Opfs.write).not.toHaveBeenCalled()
    expect(Workers.Opfs.delete).not.toHaveBeenCalled()
})
it("preserves the primary failure when cleanup fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const primary = new Error("media write failed")
    vi.mocked(Workers.Opfs.write).mockRejectedValue(primary)
    vi.mocked(Workers.Opfs.delete).mockRejectedValue(new Error("cleanup failed"))
    await expect(SoundfontStorage.get().save(font())).rejects.toBe(primary)
})

it("repairs an incomplete stock cache and makes loader retry succeed", async () => {
    files.set(`${root}/soundfont.sf2`, syntheticSoundfont())
    vi.mocked(Workers.Opfs.write).mockRejectedValueOnce(new Error("temporary write failure"))
    const input = font()
    const manager = {fetch: vi.fn().mockResolvedValue([input.file, input.meta])}
    const loader = new DefaultSoundfontLoader(manager as unknown as ConstructorParameters<typeof DefaultSoundfontLoader>[0], UUID.parse(a))
    await vi.waitFor(() => expect(loader.state.type).toBe("error"))
    expect(files.has(`${root}/meta.json`)).toBe(false)
    loader.invalidate()
    await vi.waitFor(() => expect(loader.state.type).toBe("loaded"))
    expect(manager.fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(new TextDecoder().decode(files.get(`${root}/meta.json`)))).toEqual(input.meta)
})
it("repairs the same-file import identity instead of making a hidden incomplete UUID permanent", async () => {
    files.set(`${root}/soundfont.sf2`, syntheticSoundfont())
    vi.spyOn(OpenSoundfontAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSoundfontAPI.get>)
    vi.spyOn(Wait, "frame").mockResolvedValue()
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate: vi.fn()} as unknown as ReturnType<typeof RuntimeNotifier.progress>)
    const service = new SoundfontService()
    await vi.waitFor(() => expect(service.local.isEmpty()).toBe(false))
    const input = font()
    const imported = await service.importFile({uuid: input.uuid, arrayBuffer: input.file})
    expect(imported.uuid).toBe(a)
    expect(files.has(`${root}/meta.json`)).toBe(true)
    const writes = vi.mocked(Workers.Opfs.write).mock.calls.length
    await service.importFile({uuid: input.uuid, arrayBuffer: input.file})
    expect(Workers.Opfs.write).toHaveBeenCalledTimes(writes)
})
