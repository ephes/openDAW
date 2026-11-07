import {afterEach, expect, it, vi} from "vitest"
import JSZip from "jszip"
import {DawProject} from "./DawProject"

it("rejects expanded DAWproject resources and excessive entry count before returning assets", async () => {
    const zip = new JSZip().file("project.xml", '<Project version="1.0"/>').file("audio.wav", new Uint8Array(100_000))
    const bytes = await zip.generateAsync({type: "arraybuffer", compression: "DEFLATE"})
    await expect(DawProject.decode(bytes, {entries: 2, metadata: 100, media: 100, total: 200})).rejects.toThrow(/limit/)
    await expect(DawProject.decode(bytes, {entries: 1, metadata: 100, media: 100_000, total: 100_100})).rejects.toThrow(/limit/)
})
it("reads ordinary bounded project metadata and resources", async () => {
    const bytes = await new JSZip().file("project.xml", '<Project version="1.0"/>')
        .file("metadata.xml", '<MetaData><Title>Synthetic</Title></MetaData>')
        .generateAsync({type: "arraybuffer"})
    const result = await DawProject.decode(bytes)
    expect(result.project.version).toBe("1.0")
    expect(result.metaData.title).toBe("Synthetic")
})

afterEach(() => vi.restoreAllMocks())
it("accepts project XML larger than the metadata limit", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {})
    const xml = '<Project version="1.0"><!--' + 'x'.repeat(1_048_577) + '--></Project>'
    const bytes = await new JSZip().file("project.xml", xml).generateAsync({type: "arraybuffer", compression: "DEFLATE"})
    await expect(DawProject.decode(bytes)).resolves.toHaveProperty("project.version", "1.0")
})
