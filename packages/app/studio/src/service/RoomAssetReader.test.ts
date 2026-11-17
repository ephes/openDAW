import {beforeEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioFileBox, BoxIO, SoundfontFileBox} from "@opendaw/studio-boxes"
import {createRoomAssetReader} from "./RoomAssetReader"

const storage = vi.hoisted(() => ({
    sampleExists: vi.fn(async () => true),
    opfsExists: vi.fn(async () => true),
    opfsRead: vi.fn(async (path: string) => new TextEncoder().encode(path.endsWith("meta.json") ? "{\"name\":\"synthetic\"}" : "RIFF")),
    soundfontLoad: vi.fn(async () => [new ArrayBuffer(4), {name: "synthetic"}])
}))
vi.mock("@opendaw/studio-core", () => ({
    SampleStorage: {Folder: "samples/v2", get: () => ({exists: storage.sampleExists})},
    SoundfontStorage: {Folder: "soundfont", get: () => ({load: storage.soundfontLoad})},
    Workers: {Opfs: {exists: storage.opfsExists, read: storage.opfsRead}}
}))

const createGraph = () => {
    const graph = new BoxGraph<BoxIO.TypeMap>()
    const sample = UUID.generate(), soundfont = UUID.generate()
    graph.beginTransaction()
    AudioFileBox.create(graph, sample)
    SoundfontFileBox.create(graph, soundfont)
    graph.endTransaction()
    return {graph, sample, soundfont}
}

beforeEach(() => {vi.clearAllMocks()})

it("shares only samples and soundfonts referenced by the room project", async () => {
    const {graph, sample, soundfont} = createGraph()
    const reader = createRoomAssetReader(graph)
    const foreign = UUID.generate()
    expect(await reader.hasSample(sample)).toBe(true)
    expect(await reader.hasSoundfont(soundfont)).toBe(true)
    expect(await reader.hasSample(foreign)).toBe(false)
    expect(await reader.hasSoundfont(foreign)).toBe(false)
    expect(await reader.hasSample(soundfont)).toBe(false)
    expect(await reader.hasSoundfont(sample)).toBe(false)
    expect(storage.sampleExists).toHaveBeenCalledTimes(1)
    expect(storage.opfsExists).toHaveBeenCalledTimes(1)
})

it("never reads local storage for assets outside the room project", async () => {
    const {graph, sample, soundfont} = createGraph()
    const reader = createRoomAssetReader(graph)
    const foreign = UUID.generate()
    await expect(reader.readSample(foreign)).rejects.toThrow()
    await expect(reader.readSoundfont(foreign)).rejects.toThrow()
    await expect(reader.readSample(soundfont)).rejects.toThrow()
    expect(storage.opfsRead).not.toHaveBeenCalled()
    expect(storage.soundfontLoad).not.toHaveBeenCalled()
    const [, meta] = await reader.readSample(sample)
    expect(meta).toEqual({name: "synthetic"})
    await reader.readSoundfont(soundfont)
    expect(storage.soundfontLoad).toHaveBeenCalledTimes(1)
})

it("stops sharing an asset once the room project no longer references it", async () => {
    const {graph, sample} = createGraph()
    const reader = createRoomAssetReader(graph)
    graph.beginTransaction()
    graph.findBox(sample).unwrap().delete()
    graph.endTransaction()
    expect(await reader.hasSample(sample)).toBe(false)
    await expect(reader.readSample(sample)).rejects.toThrow()
    expect(storage.opfsRead).not.toHaveBeenCalled()
})
