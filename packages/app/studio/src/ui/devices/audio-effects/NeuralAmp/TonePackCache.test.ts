import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Workers} from "@opendaw/studio-core"
import {readModelFromPack, readPackMetaFromId, scanCachedModels, storePackToOpfs} from "./NamTone3000"

vi.mock("@opendaw/studio-core", () => ({Workers: {Opfs: {exists: vi.fn(), read: vi.fn(), write: vi.fn(), delete: vi.fn(), list: vi.fn()}}}))
vi.mock("./Tone3000Dialog", () => ({showTone3000Dialog: async () => {}}))
const files = new Map<string, Uint8Array>()
const enc = new TextEncoder()
const model = (revision: string) => JSON.stringify({version: "0.5.4", architecture: "WaveNet", config: {}, weights: [1], metadata: {name: revision}})
const tone = (revision: string) => ({id: 1, title: "Synthetic pack", updated_at: revision,
    models: [1, 2].map(id => ({id, name: `Model ${id}`, size: id === 1 ? "standard" : "lite", model_url: `https://example.test/${revision}/${id}`}))})
beforeEach(() => {
    files.clear()
    vi.mocked(Workers.Opfs.exists).mockImplementation(async path => files.has(path))
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => {if (!files.has(path)) {throw new DOMException("missing", "NotFoundError")}; return files.get(path)!})
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes.slice())})
    vi.mocked(Workers.Opfs.delete).mockImplementation(async path => {for (const key of files.keys()) {if (key === path || key.startsWith(`${path}/`)) {files.delete(key)}}})
    vi.mocked(Workers.Opfs.list).mockImplementation(async path => [...new Set([...files.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path.length + 1).split("/")[0]))].map(name => ({name, kind: [...files.keys()].some(key => key.startsWith(`${path}/${name}/`)) ? "directory" : "file"})))
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => new Response(model(String(url)))))
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})
it("refreshes same-ID bytes across persisted revisions and retains unchanged cache hits", async () => {
    await storePackToOpfs(tone("v1"))
    expect(await readModelFromPack("1", 1)).toContain("v1")
    const meta = await storePackToOpfs(tone("v2"))
    expect(await readModelFromPack("1", 1)).toContain("v2")
    expect(await readPackMetaFromId("1")).toEqual(meta)
    expect(await scanCachedModels("1", meta)).toEqual(new Set([1]))
    const fetchCount = vi.mocked(fetch).mock.calls.length
    await storePackToOpfs(tone("v2")); await readModelFromPack("1", 1)
    expect(fetch).toHaveBeenCalledTimes(fetchCount)
})
it("does not return or publish a late old-revision download into the current pack", async () => {
    await storePackToOpfs(tone("v1"))
    const gate = Promise.withResolvers<Response>()
    vi.mocked(fetch).mockImplementationOnce(() => gate.promise)
    const old = readModelFromPack("1", 2)
    const settled = old.then(() => "loaded", () => "retired")
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "https://example.test/v1/2")).toBe(true))
    await storePackToOpfs(tone("v2"))
    gate.resolve(new Response(model("OLD")))
    expect(await settled).toBe("retired")
    expect(await readModelFromPack("1", 2)).toContain("v2")
})
it("does not trust legacy unversioned model bytes", async () => {
    const v1 = tone("v1")
    files.set("tone3000/1/pack.json", enc.encode(JSON.stringify({toneId: 1, title: v1.title, updatedAt: "v1", models: v1.models})))
    files.set("tone3000/1/models/1.nam", enc.encode(model("OLD")))
    expect(await readModelFromPack("1", 1)).not.toContain("OLD")
})
