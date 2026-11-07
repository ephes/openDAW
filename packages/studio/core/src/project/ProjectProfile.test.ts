import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Option, UUID} from "@opendaw/lib-std"
import {ProjectProfile} from "./ProjectProfile"
import {ProjectMeta} from "./ProjectMeta"
import {ProjectPaths} from "./ProjectPaths"
import {Workers} from "../Workers"
import type {Project} from "./Project"
vi.mock("../Workers", () => ({Workers: {Opfs: {write: vi.fn(), read: vi.fn(), delete: vi.fn()}}}))
let files: Map<string, Uint8Array>
const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes))
beforeEach(() => {
    files = new Map()
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {files.delete(path)})
    let queue = Promise.resolve<unknown>(undefined)
    Object.defineProperty(navigator, "locks", {configurable: true, value: {request: (_key: string, task: () => Promise<unknown>) => {
        const next = queue.catch(() => {}).then(task); queue = next; return next
    }}})
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
const fixture = (saved = true, cover = Option.wrap(new Uint8Array([7, 8]).buffer)) => {
    let value = 1, savedValue = 0
    const editing = {mark: vi.fn(), markSaved: vi.fn(() => {savedValue = value}), hasUnsavedChanges: () => savedValue !== value}
    const makeProject = (): Project => ({editing, toArrayBuffer: () => new Uint8Array([value]).buffer,
        copy: () => {const snapshot = value; return {editing, toArrayBuffer: () => new Uint8Array([snapshot]).buffer} as unknown as Project}} as unknown as Project)
    const profile = new ProjectProfile(UUID.generate(), makeProject(), ProjectMeta.init("Original"), cover, saved)
    return {profile, editing, edit: () => {value++}}
}
for (const saved of [true, false]) {
    it(`retains graph/title/cover edits during ${saved ? "save" : "initial saveAs"}`, async () => {
        const {profile, edit} = fixture(saved)
        const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
        vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {
            if (path.endsWith("project.od")) {entered.resolve(); await gate.promise}
            files.set(path, bytes.slice())
        })
        const writing = saved ? profile.save() : profile.saveAs(Object.assign({}, profile.meta, {name: "First"}))
        await entered.promise
        edit(); profile.updateMetaData("name", "Later"); profile.updateCover(Option.wrap(new Uint8Array([9]).buffer))
        gate.resolve(); await writing
        expect(files.get(ProjectPaths.projectFile(profile.uuid))).toEqual(new Uint8Array([1]))
        expect(json(files.get(ProjectPaths.projectMeta(profile.uuid))!).name).toBe(saved ? "Original" : "First")
        expect(files.get(ProjectPaths.projectCover(profile.uuid))).toEqual(new Uint8Array([7, 8]))
        expect(profile.meta.name).toBe("Later")
        expect(profile.hasUnsavedChanges()).toBe(true)
        await profile.save()
        expect(profile.hasUnsavedChanges()).toBe(false)
    })
}
for (const fail of [false, true]) {
    it(`keeps original metadata and dirty state on ${fail ? "failed" : "successful"} Save As`, async () => {
        const {profile, editing} = fixture()
        editing.markSaved()
        const original = structuredClone(profile.meta)
        if (fail) {vi.mocked(Workers.Opfs.write).mockRejectedValueOnce(new Error("write failed"))}
        const result = profile.saveAs(Object.assign({}, profile.meta, {name: "Copy"}))
        if (fail) {await expect(result).rejects.toThrow("write failed")}
        else {
            const copy = (await result).unwrap()
            expect(copy.meta.name).toBe("Copy")
            expect(files.get(ProjectPaths.projectCover(copy.uuid))).toEqual(new Uint8Array([7, 8]))
            new Uint8Array(profile.cover.unwrap())[0] = 99
            expect(new Uint8Array(copy.cover.unwrap())).toEqual(new Uint8Array([7, 8]))
            copy.meta.tags.push("copy")
            expect(profile.meta.tags).toEqual([])
        }
        expect(profile.meta).toEqual(original)
        expect(profile.hasUnsavedChanges()).toBe(false)
    })
}
it("copies absent covers without creating a cover file", async () => {
    const {profile} = fixture(true, Option.None)
    const copy = (await profile.saveAs(Object.assign({}, profile.meta, {name: "Copy"}))).unwrap()
    expect(copy.cover.isEmpty()).toBe(true)
    expect(files.has(ProjectPaths.projectCover(copy.uuid))).toBe(false)
})
it("persists cover removal and keeps failed deletion dirty", async () => {
    const {profile} = fixture()
    await profile.save()
    profile.updateCover(Option.None)
    vi.mocked(Workers.Opfs.delete).mockRejectedValueOnce(new Error("delete failed"))
    await expect(profile.save()).rejects.toThrow("delete failed")
    expect(profile.hasUnsavedChanges()).toBe(true)
    await profile.save()
    expect(files.has(ProjectPaths.projectCover(profile.uuid))).toBe(false)
    expect(profile.hasUnsavedChanges()).toBe(false)
})
it("does not publish initial Save As metadata when writing fails", async () => {
    const {profile} = fixture(false)
    const before = structuredClone(profile.meta)
    vi.mocked(Workers.Opfs.write).mockRejectedValueOnce(new Error("write failed"))
    await expect(profile.saveAs(Object.assign({}, profile.meta, {name: "Failed"}))).rejects.toThrow()
    expect(profile.meta).toEqual(before)
    expect(profile.saved()).toBe(false)
})
