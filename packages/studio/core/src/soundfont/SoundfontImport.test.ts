// @vitest-environment node
import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {Files} from "@opendaw/lib-dom"
import {Wait} from "@opendaw/lib-runtime"
import {SoundfontService} from "./SoundfontService"
import {SoundfontStorage} from "./SoundfontStorage"
import {OpenSoundfontAPI} from "./OpenSoundfontAPI"
import {ExternalLib} from "../ExternalLib"

vi.mock("../Workers", () => ({Workers: {}}))
const save = vi.fn()
const parse = vi.fn()
const large = () => new ArrayBuffer(16 * 1024 * 1024 + 1)
beforeEach(() => {
    vi.spyOn(SoundfontStorage, "get").mockReturnValue({list: async () => [], save} as unknown as SoundfontStorage)
    vi.spyOn(OpenSoundfontAPI, "get").mockReturnValue({all: async () => []} as unknown as ReturnType<typeof OpenSoundfontAPI.get>)
    vi.spyOn(Wait, "frame").mockResolvedValue()
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate: vi.fn()} as unknown as ReturnType<typeof RuntimeNotifier.progress>)
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
    vi.spyOn(ExternalLib, "SoundFont2").mockResolvedValue({status: "resolved", value: class {
        metaData = {name: "Synthetic"}
        constructor() {parse()}
    }} as unknown as Awaited<ReturnType<typeof ExternalLib.SoundFont2>>)
    vi.spyOn(UUID, "sha256").mockResolvedValue(UUID.generate())
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
const service = async () => {
    const instance = new SoundfontService()
    await vi.waitFor(() => expect(instance.local.nonEmpty()).toBe(true))
    return instance
}

it("declines a large import before progress, hashing, parsing, storage or notification", async () => {
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
    const instance = await service(), notify = vi.fn()
    instance.subscribe(notify)
    await expect(instance.importFile({arrayBuffer: large()})).rejects.toMatchObject({name: "AbortError"})
    expect(RuntimeNotifier.progress).not.toHaveBeenCalled()
    expect(Wait.frame).not.toHaveBeenCalled()
    expect(UUID.sha256).not.toHaveBeenCalled()
    expect(ExternalLib.SoundFont2).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(instance.local.unwrap()).toEqual([])
})

it("imports an approved large font", async () => {
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(true)
    const instance = await service()
    const imported = await instance.importFile({arrayBuffer: large()})
    expect(imported.name).toBe("Synthetic")
    expect(save).toHaveBeenCalledOnce()
    expect(parse).toHaveBeenCalledOnce()
    expect(instance.local.unwrap()).toEqual([imported])
})

it("treats a declined browse import as normal cancellation", async () => {
    vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
    vi.spyOn(Files, "open").mockResolvedValue([{name: "synthetic.sf2", arrayBuffer: async () => large()}] as File[])
    const instance = await service()
    await expect(instance.browse(false)).resolves.toEqual([])
    expect(RuntimeNotifier.info).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
})
