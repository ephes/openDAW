import {afterEach, expect, it, vi} from "vitest"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {AudioData, LoopableRegion, PPQN, TimeBase, WavFile} from "@opendaw/lib-dsp"
import {AudioPitchStretchBox, AudioRegionBox, WarpMarkerBox} from "@opendaw/studio-boxes"
import {BoxGraph} from "@opendaw/lib-box"
import {Option, UUID} from "@opendaw/lib-std"
import {SampleLoaderManager} from "@opendaw/studio-adapters"
import {DawProjectExporter} from "./DawProjectExporter"
import {DawProjectImport} from "./DawProjectImporter"

const fixture = (attributes = 'playStart="2"', markers = '<Warp time="0" contentTime="0"/><Warp time="8" contentTime="4"/>', duration = 4) => {
    const data = AudioData.create(4, 16, 1)
    data.frames[0].set(Float32Array.from({length: 16}, (_, index) => index))
    const buffer = WavFile.encodeFloats(data)
    const resource = {uuid: UUID.generate(), name: "ramp.wav", path: "ramp.wav", buffer}
    const resources = {fromPath: vi.fn(() => resource), fromUUID: vi.fn(() => resource)}
    const schema = Xml.parse(`<Project version="1.0"><Structure>
        <Track id="audio" contentType="audio"><Channel id="channel" role="regular" destination="master"/></Track>
        <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>
    </Structure><Arrangement><Lanes><Lanes track="audio"><Clips>
        <Clip time="10" duration="${duration}" ${attributes}><Warps contentTimeUnit="seconds">${markers}
            <Audio duration="4" channels="1" sampleRate="4" algorithm="repitch"><File path="ramp.wav"/></Audio>
        </Warps></Clip>
    </Clips></Lanes></Lanes></Arrangement></Project>`, ProjectSchema)
    return {schema, resources, resource, data, run: () => DawProjectImport.read(schema, resources)}
}
afterEach(() => vi.restoreAllMocks())
it("preserves a trimmed ramp's first source sample and region extent", async () => {
    const f = fixture()
    const {skeleton} = await f.run()
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    expect(region.position.getValue()).toBe(10 * PPQN.Quarter)
    expect(region.duration.getValue()).toBe(4 * PPQN.Quarter)
    const position = region.position.getValue(), complete = position + region.duration.getValue()
    const cycle = [...LoopableRegion.locateLoops({position, complete, loopOffset: region.loopOffset.getValue(), loopDuration: region.loopDuration.getValue()}, position, complete)][0]
    const markers = skeleton.boxGraph.boxes().filter(box => box instanceof WarpMarkerBox).sort((a, b) => a.position.getValue() - b.position.getValue())
    const sourceSeconds = (cycle.resultStart - cycle.rawStart) / markers[1].position.getValue() * markers[1].seconds.getValue()
    const decoded = WavFile.decodeFloats(f.resource.buffer)
    expect(sourceSeconds).toBe(1)
    expect(decoded.frames[0][sourceSeconds * decoded.sampleRate]).toBe(4)
    expect(region.playMode.targetVertex.unwrap().box).toBeInstanceOf(AudioPitchStretchBox)
})
it.each([
    '<Warp time="0" contentTime="0"/><Warp time="8" contentTime="4"/>',
    '<Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/><Warp time="8" contentTime="4"/>'
])("keeps linear source scale when the loop ends before the source does", async markers => {
    const {skeleton} = await fixture('playStart="2" loopStart="0" loopEnd="4"', markers).run()
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    expect(region.loopOffset.getValue()).toBe(2 * PPQN.Quarter)
    expect(region.loopDuration.getValue()).toBe(4 * PPQN.Quarter)
    const end = skeleton.boxGraph.boxes().filter(box => box instanceof WarpMarkerBox).sort((a, b) => a.position.getValue() - b.position.getValue())[1]
    expect(end.position.getValue()).toBe(8 * PPQN.Quarter)
    expect(end.seconds.getValue()).toBe(4)
})
it("refuses a nonlinear mapping before graph mutation or resource reads", async () => {
    const f = fixture('', '<Warp time="0" contentTime="0"/><Warp time="4" contentTime="3"/><Warp time="8" contentTime="4"/>')
    const begin = vi.spyOn(BoxGraph.prototype, "beginTransaction")
    await expect(f.run()).rejects.toThrow(/Unsupported nonlinear warp/)
    expect(begin).not.toHaveBeenCalled()
    expect(f.resources.fromPath).not.toHaveBeenCalled()
})
it.each(['playStart="2" loopStart="1" loopEnd="4"', 'playStart="8"', 'playStart="6"', 'loopEnd="0"'])("refuses unrepresentable playback %s", async attributes => {
    const f = fixture(attributes)
    await expect(f.run()).rejects.toThrow(/Unsupported audio playback window/)
    expect(f.resources.fromPath).not.toHaveBeenCalled()
})
it("refuses nonzero warp origins instead of replacing them with zero", async () => {
    await expect(fixture('', '<Warp time="1" contentTime="0.5"/><Warp time="8" contentTime="4"/>').run()).rejects.toThrow(/Unsupported warp source window/)
})
it.each([4, 16])("round-trips trimmed/looped audio of %s beats with its source warp scale", async duration => {
    const f = fixture('playStart="2" loopEnd="4"', undefined, duration)
    const imported = await f.run()
    const samples = {getOrCreate: () => ({data: Option.wrap(f.data)})} as unknown as SampleLoaderManager
    const exported = DawProjectExporter.write(imported.skeleton, samples, {
        write: (path, _buffer) => Xml.element({path, external: false}, FileReferenceSchema)
    })
    const {skeleton} = await DawProjectImport.read(Xml.parse(Xml.pretty(Xml.toElement("Project", exported)), ProjectSchema), f.resources)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    expect(region.duration.getValue()).toBe(duration * PPQN.Quarter)
    expect(region.loopOffset.getValue()).toBe(2 * PPQN.Quarter)
    expect(region.loopDuration.getValue()).toBe(4 * PPQN.Quarter)
    const markers = skeleton.boxGraph.boxes().filter(box => box instanceof WarpMarkerBox).sort((a, b) => a.position.getValue() - b.position.getValue())
    expect(markers.map(marker => [marker.position.getValue() / PPQN.Quarter, marker.seconds.getValue()])).toEqual([[0, 0], [8, 4]])
})
it("refuses to export unloaded audio instead of writing an empty warped clip", async () => {
    const f = fixture()
    const imported = await f.run()
    const samples = {getOrCreate: () => ({data: Option.None})} as unknown as SampleLoaderManager
    expect(() => DawProjectExporter.write(imported.skeleton, samples, {write: (path, _buffer) => Xml.element({path, external: false}, FileReferenceSchema)})).toThrow(/Cannot export unloaded audio/)
})
it("refuses beat-valued warp source coordinates explicitly", async () => {
    const f = fixture()
    const xml = Xml.pretty(Xml.toElement("Project", f.schema)).replace('contentTimeUnit="seconds"', 'contentTimeUnit="beats"')
    await expect(DawProjectImport.read(Xml.parse(xml, ProjectSchema), f.resources)).rejects.toThrow(/Unsupported warp source time unit/)
})
it("exports ordinary no-stretch audio with second-based extents at constant tempo", async () => {
    const f = fixture()
    const imported = await f.run()
    const region = imported.skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    imported.skeleton.boxGraph.beginTransaction()
    region.playMode.defer()
    region.timeBase.setValue(TimeBase.Seconds)
    region.duration.setValue(2)
    region.loopDuration.setValue(4)
    region.loopOffset.setValue(0)
    imported.skeleton.mandatoryBoxes.timelineBox.bpm.setValue(120)
    imported.skeleton.boxGraph.endTransaction()
    const samples = {getOrCreate: () => ({data: Option.wrap(f.data)})} as unknown as SampleLoaderManager
    const exported = DawProjectExporter.write(imported.skeleton, samples, {write: (path, _buffer) => Xml.element({path}, FileReferenceSchema)})
    const {skeleton} = await DawProjectImport.read(Xml.parse(Xml.pretty(Xml.toElement("Project", exported)), ProjectSchema), f.resources)
    const result = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    expect(result.position.getValue()).toBe(10 * PPQN.Quarter)
    expect(result.duration.getValue()).toBe(4 * PPQN.Quarter)
    expect(result.loopDuration.getValue()).toBe(8 * PPQN.Quarter)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof WarpMarkerBox).map(box => box.seconds.getValue()).sort()).toEqual([0, 4])
})
