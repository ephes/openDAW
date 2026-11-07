import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Option, UUID} from "@opendaw/lib-std"
import {Recovery} from "./Recovery"
import {Project} from "./Project"
import {ProjectMeta} from "./ProjectMeta"
import {ProjectProfile} from "./ProjectProfile"
import type {ProjectEnv} from "./ProjectEnv"
import {Workers} from "../Workers"
vi.mock("./Project", () => ({Project: {loadAnyVersion: vi.fn()}}))
vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn(), write: vi.fn(), list: vi.fn(), delete: vi.fn()}}}))
let files: Map<string, Uint8Array>
const encode = (x: unknown) => new TextEncoder().encode(JSON.stringify(x))
const env = {} as ProjectEnv
const profile = (n: number) => new ProjectProfile(UUID.generate(), {toArrayBuffer: () => new Uint8Array([n]).buffer} as unknown as Project,
    ProjectMeta.init(`Profile ${n}`), Option.None, true)
const recovery = (p = profile(1)) => new Recovery(() => Option.wrap(p), env)
const legacy = () => {
    files.set(".backup/uuid", UUID.generate())
    files.set(".backup/project.od", new Uint8Array([1]))
    files.set(".backup/meta.json", encode(ProjectMeta.init("Legacy")))
    files.set(".backup/saved", new Uint8Array([1]))
}
beforeEach(() => {
    files = new Map()
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {
        if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")}
        return files.get(path)!.slice()
    })
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    vi.mocked(Workers.Opfs.list).mockImplementation(async path => {
        const names = new Map<string, "file" | "directory">()
        for (const key of files.keys()) {
            if (!key.startsWith(path + "/")) {continue}
            const tail = key.slice(path.length + 1), name = tail.split("/")[0]
            names.set(name, tail.includes("/") ? "directory" : "file")
        }
        return Array.from(names, ([name, kind]) => ({name, kind}))
    })
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {
        for (const key of files.keys()) {if (key === path || key.startsWith(path + "/")) {files.delete(key)}}
    })
    vi.mocked(Project.loadAnyVersion).mockImplementation(async (_env, bytes) => ({fixture: new Uint8Array(bytes)[0], terminate: vi.fn()} as unknown as Project))
    let queue = Promise.resolve<unknown>(undefined)
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (_key: string, task: () => Promise<unknown>) => {
        const next = queue.catch(() => {}).then(task); queue = next; return next
    }}})
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
for (const file of ["uuid", "project.od", "meta.json", "saved", "conversion"]) {
    it(`retains legacy backup on ${file} failure`, async () => {
        legacy()
        const before = new Map(files)
        if (file === "conversion") {vi.mocked(Project.loadAnyVersion).mockRejectedValueOnce(new Error("convert"))}
        else {
            const read = Workers.Opfs.read
            const impl = vi.mocked(read).getMockImplementation()!
            vi.mocked(read).mockImplementation(async path => {if (path === `.backup/${file}`) {throw new Error("read")}; return impl(path)})
        }
        expect((await recovery().restoreProfile()).isEmpty()).toBe(true)
        expect(files).toEqual(before)
        expect(Workers.Opfs.delete).not.toHaveBeenCalled()
    })
}
for (const failure of [1, 2, 3, 4, 5]) {
    it(`retains the previous generation when publication write ${failure} is short`, async () => {
        const first = recovery(profile(1))
        await first.createBackupCommand().unwrap()()
        let count = 0
        vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
            if (++count === failure) {files.set(path, bytes.slice(0, 1)); throw new Error("short write")}
            files.set(path, bytes.slice())
        })
        await expect(recovery(profile(2)).createBackupCommand().unwrap()()).rejects.toThrow("short write")
        expect(count).toBe(failure)
        const restored = (await first.restoreProfile()).unwrap()
        expect(restored.meta.name).toBe("Profile 1")
        expect((restored.project as unknown as {fixture: number}).fixture).toBe(1)
    })
}
it("serializes overlapping writers and consumes only the accepted generation", async () => {
    const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
    let first = true
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
        if (first) {first = false; entered.resolve(); await gate.promise}
        files.set(path, bytes.slice())
    })
    const a = recovery(profile(1)), b = recovery(profile(2))
    const writingA = a.createBackupCommand().unwrap()()
    await entered.promise
    const writingB = b.createBackupCommand().unwrap()()
    gate.resolve(); await Promise.all([writingA, writingB])
    const restored = (await b.restoreProfile()).unwrap()
    expect(restored.meta.name).toBe("Profile 2")
    expect((restored.project as unknown as {fixture: number}).fixture).toBe(2)
    expect((await a.restoreProfile()).isEmpty()).toBe(true)
    expect([...files.keys()].some(path => path.endsWith("project.od"))).toBe(true)
})
it("preserves a committed generation on conversion failure", async () => {
    const r = recovery()
    await r.createBackupCommand().unwrap()()
    const before = new Map(files)
    vi.mocked(Project.loadAnyVersion).mockRejectedValueOnce(new Error("conversion"))
    expect((await r.restoreProfile()).isEmpty()).toBe(true)
    expect(files).toEqual(before)
})
it("consumes a successful legacy restore only after validation", async () => {
    legacy()
    expect((await recovery().restoreProfile()).unwrap().meta.name).toBe("Legacy")
    expect(files.size).toBe(0)
})
