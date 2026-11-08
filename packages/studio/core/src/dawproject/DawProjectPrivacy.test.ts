import {afterEach, expect, it, vi} from "vitest"
import JSZip from "jszip"
import {AudioData, PPQN, WavFile} from "@opendaw/lib-dsp"
import {AudioRegionBox} from "@opendaw/studio-boxes"
import {Option} from "@opendaw/lib-std"
import {SampleLoaderManager} from "@opendaw/studio-adapters"
import {DawProject} from "./DawProject"
import {DawProjectImport} from "./DawProjectImporter"

const projectXml = `<Project version="1.0"><Structure>
    <Track id="notes" name="PrivateTrackSentinel" contentType="notes"><Channel id="channel" role="regular" destination="master"/></Track>
    <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>
</Structure><Arrangement><Lanes><Lanes track="notes"><Clips>
    <Clip time="0" duration="8" name="PrivateClipSentinel"><Notes><Note time="0" duration="1" key="60" channel="0"/></Notes></Clip>
</Clips></Lanes></Lanes></Arrangement></Project>`
afterEach(() => vi.restoreAllMocks())
it("round-trips synthetic private metadata and tracks without logging document content", async () => {
    const spies = ["debug", "info", "log", "warn", "error"].map(method => vi.spyOn(console, method as "debug").mockImplementation(() => {}))
    const bytes = await new JSZip().file("project.xml", projectXml)
        .file("metadata.xml", '<MetaData><Artist>PrivateAuthorSentinel</Artist><Comment>PrivateCommentSentinel</Comment></MetaData>')
        .generateAsync({type: "arraybuffer"})
    const decoded = await DawProject.decode(bytes)
    const {skeleton} = await DawProjectImport.read(decoded.project, decoded.resources)
    const samples = {getOrCreate: () => {throw new Error("No samples expected")}} as unknown as SampleLoaderManager
    const encoded = await DawProject.encode(skeleton, samples, decoded.metaData)
    const result = await DawProject.decode(encoded)
    expect(result.metaData.artist).toBe("PrivateAuthorSentinel")
    expect(result.metaData.comment).toBe("PrivateCommentSentinel")
    const zip = await JSZip.loadAsync(encoded)
    expect(await zip.file("project.xml")!.async("string")).toContain("PrivateTrackSentinel")
    expect(await zip.file("project.xml")!.async("string")).toContain("PrivateClipSentinel")
    expect(JSON.stringify(spies.flatMap(spy => spy.mock.calls))).not.toContain("Private")
})
const audioContent = `<Warps contentTimeUnit="seconds"><Warp time="0" contentTime="0"/><Warp time="8" contentTime="4"/>
    <Audio duration="4" channels="1" sampleRate="4"><File path="PrivatePathSentinel.wav"/></Audio></Warps>`
const withContent = (content: string, attributes = "") => projectXml.replace('duration="8" name="PrivateClipSentinel"', `duration="8" name="PrivateClipSentinel" ${attributes}`)
    .replace(/<Notes>.*?<\/Notes>/, content).replace('contentType="notes"', 'contentType="audio"')
const sample = () => {
    const data = AudioData.create(4, 16, 1)
    data.frames[0].set(Float32Array.from({length: 16}, (_, index) => index / 16))
    return data
}
it("exports second-labeled audio sources accepted by decode and import without content logs", async () => {
    const spies = ["debug", "info", "log", "warn", "error"].map(method => vi.spyOn(console, method as "debug").mockImplementation(() => {}))
    const data = sample()
    const bytes = await new JSZip().file("project.xml", withContent(audioContent))
        .file("PrivatePathSentinel.wav", WavFile.encodeFloats(data)).generateAsync({type: "arraybuffer"})
    const decoded = await DawProject.decode(bytes)
    const {skeleton} = await DawProjectImport.read(decoded.project, decoded.resources)
    const samples = {getOrCreate: () => ({data: Option.wrap(data)})} as unknown as SampleLoaderManager
    const encoded = await DawProject.encode(skeleton, samples, decoded.metaData)
    const archive = await JSZip.loadAsync(encoded)
    const xml = await archive.file("project.xml")!.async("string")
    expect(xml).toMatch(/<Warps[^>]*contentTimeUnit="seconds"/)
    const result = await DawProject.decode(encoded)
    const imported = await DawProjectImport.read(result.project, result.resources)
    const region = imported.skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    expect(region.duration.getValue()).toBe(8 * PPQN.Quarter)
    expect(region.loopDuration.getValue()).toBe(8 * PPQN.Quarter)
    expect(JSON.stringify(spies.flatMap(spy => spy.mock.calls))).not.toContain("Private")
})
it("keeps structural warning content private", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "debug").mockImplementation(() => {})
    const xml = withContent('<Points id="PrivateContentSentinel"/>')
    const bytes = await new JSZip().file("project.xml", xml)
        .file("PrivatePathSentinel.wav", WavFile.encodeFloats(sample())).generateAsync({type: "arraybuffer"})
    const decoded = await DawProject.decode(bytes)
    await DawProjectImport.read(decoded.project, decoded.resources)
    expect(warn).toHaveBeenCalledWith("Unsupported DAWproject region content")
    expect(warn.mock.calls.every(args => args.length === 1 && typeof args[0] === "string")).toBe(true)
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Private")
})
it("refuses sub-pulse audio loops without exposing document content", async () => {
    const spies = ["debug", "info", "log", "warn", "error"].map(method => vi.spyOn(console, method as "debug").mockImplementation(() => {}))
    const bytes = await new JSZip().file("project.xml", withContent(audioContent, `loopEnd="${0.25 / PPQN.Quarter}"`))
        .file("PrivatePathSentinel.wav", WavFile.encodeFloats(sample())).generateAsync({type: "arraybuffer"})
    const decoded = await DawProject.decode(bytes)
    await expect(DawProjectImport.read(decoded.project, decoded.resources)).rejects.toThrow("Unsupported audio playback window")
    expect(JSON.stringify(spies.flatMap(spy => spy.mock.calls))).not.toContain("Private")
})
