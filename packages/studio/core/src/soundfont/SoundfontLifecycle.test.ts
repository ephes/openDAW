import {afterEach, beforeEach, expect, it, vi} from "vitest"
import JSZip from "jszip"
import {Option, Terminable, UUID} from "@opendaw/lib-std"
import {SoundfontLoader, SoundfontLoaderState, SoundfontMetaData} from "@opendaw/studio-adapters"
import {SoundfontFileBox} from "@opendaw/studio-boxes"
import {DefaultSoundfontLoader} from "./DefaultSoundfontLoader"
import {GlobalSoundfontLoaderManager} from "./GlobalSoundfontLoaderManager"
import {SoundfontStorage} from "./SoundfontStorage"
import {ExternalLib} from "../ExternalLib"
import {ProjectBundle} from "../project/ProjectBundle"
import {ProjectProfile} from "../project/ProjectProfile"
vi.mock("../project/Project", () => ({Project: {loadAnyVersion: vi.fn()}}))
const uuid = UUID.parse("00000000-0000-4000-8000-000000000001")
const meta = (name: string): SoundfontMetaData => ({name, size: 1, url: "", license: "", origin: "import"})
const value = (name: string): [ArrayBuffer, SoundfontMetaData] => [new Uint8Array([name.charCodeAt(0)]).buffer, meta(name)]
let load: ReturnType<typeof vi.fn>
let save: ReturnType<typeof vi.fn>
let fetcher: ReturnType<typeof vi.fn>
const tick = async () => {for (let i = 0; i < 40; i++) {await Promise.resolve()}}
const readyLibrary = () => ({status: "resolved", value: class {constructor(readonly bytes: Uint8Array) {}}}) as unknown as Awaited<ReturnType<typeof ExternalLib.SoundFont2>>
beforeEach(() => {
    load = vi.fn().mockResolvedValue(value("A")); save = vi.fn().mockResolvedValue(undefined); fetcher = vi.fn().mockResolvedValue(value("F"))
    vi.spyOn(SoundfontStorage, "get").mockReturnValue({load, save} as unknown as SoundfontStorage)
    vi.spyOn(ExternalLib, "SoundFont2").mockResolvedValue(readyLibrary())
    vi.spyOn(ExternalLib, "JSZip").mockResolvedValue({status: "resolved", value: JSZip, error: undefined})
})
afterEach(() => vi.restoreAllMocks())
const loader = () => new DefaultSoundfontLoader({fetch: fetcher} as unknown as GlobalSoundfontLoaderManager, uuid)
const profile = (font: SoundfontLoader): ProjectProfile => {
    const box = Object.create(SoundfontFileBox.prototype)
    Object.defineProperty(box, "address", {value: {uuid}})
    return {uuid, cover: Option.None, meta: {}, project: {toArrayBuffer: () => new ArrayBuffer(0), boxGraph: {boxes: () => [box]}, soundfontManager: {getOrCreate: () => font}}} as unknown as ProjectProfile
}
it("replays a terminal error to late subscribers and rejects project export promptly", async () => {
    load.mockRejectedValue(new Error("timeoout synthetic"))
    const font = loader(); await tick()
    expect(font.state.type).toBe("error")
    const observer = vi.fn()
    const subscription = font.subscribe(observer)
    expect(subscription).not.toBe(Terminable.Empty)
    expect(observer).toHaveBeenCalledExactlyOnceWith(font.state)
    let failure: unknown
    const result = ProjectBundle.encode(profile(font), () => {}).catch(error => {failure = error})
    await tick()
    expect(failure).toBeInstanceOf(Error)
    await result
})
for (const source of ["cached", "fetched"]) {
    it(`publishes ${source} library failure and allows invalidate retry`, async () => {
        if (source === "fetched") {load.mockRejectedValue(new Error("missing"))}
        vi.mocked(ExternalLib.SoundFont2).mockResolvedValueOnce({status: "rejected", value: undefined, error: new Error("synthetic library")})
        const font = loader(); await tick()
        expect(font.state.type).toBe("error")
        const observer = vi.fn()
        const subscription = font.subscribe(observer)
        expect(observer).toHaveBeenCalledExactlyOnceWith(font.state)
        font.invalidate(); await tick()
        expect(font.state.type).toBe("loaded")
        expect(observer).toHaveBeenLastCalledWith({type: "loaded"})
        subscription.terminate()
    })
}
it("keeps B when cached A resolves after invalidation", async () => {
    const a = Promise.withResolvers<[ArrayBuffer, SoundfontMetaData]>()
    const b = Promise.withResolvers<[ArrayBuffer, SoundfontMetaData]>()
    load.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const font = loader(); font.invalidate()
    b.resolve(value("B")); await tick(); a.resolve(value("A")); await tick()
    expect(font.state.type).toBe("loaded"); expect(font.meta.unwrap().name).toBe("B")
})
for (const outcome of ["complete", "error"]) {
    it(`ignores stale fetched progress and ${outcome}`, async () => {
        load.mockRejectedValue(new Error("missing"))
        const a = Promise.withResolvers<[ArrayBuffer, SoundfontMetaData]>()
        let staleProgress!: (value: number) => void
        fetcher.mockImplementationOnce((_uuid: unknown, progress: (value: number) => void) => {staleProgress = progress; return a.promise})
            .mockResolvedValueOnce(value("B"))
        const font = loader(); await tick(); font.invalidate(); await tick()
        staleProgress(0.75)
        if (outcome === "complete") {a.resolve(value("A"))} else {a.reject(new Error("synthetic stale error"))}
        await tick()
        expect(font.state.type).toBe("loaded"); expect(font.meta.unwrap().name).toBe("B")
        expect(save).toHaveBeenCalledTimes(1)
    })
}
it("cleans synchronous terminal subscriptions returned by export loaders", async () => {
    const terminate = vi.fn()
    const font: SoundfontLoader = {uuid, soundfont: Option.None, invalidate() {}, state: {type: "progress", progress: 0}, subscribe(observer: (state: SoundfontLoaderState) => void) {
        observer({type: "error", reason: "synthetic terminal"}); return {terminate}
    }}
    await expect(ProjectBundle.encode(profile(font), () => {})).rejects.toThrow("synthetic terminal")
    expect(terminate).toHaveBeenCalledTimes(1)
})
