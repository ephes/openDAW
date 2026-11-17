import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {AudioData, LoopableRegion, PPQN, TimeBase} from "@opendaw/lib-dsp"
import {AudioRegionBox, NoteEventBox, NoteRegionBox} from "@opendaw/studio-boxes"
import {SampleLoaderManager} from "@opendaw/studio-adapters"
import {Option, UUID} from "@opendaw/lib-std"
import {DawProjectExporter} from "./DawProjectExporter"
import {DawProjectImport} from "./DawProjectImporter"

const q = PPQN.Quarter
const notes = '<Notes><Note time="0" duration="0.5" key="60" channel="0"/><Note time="2" duration="0.5" key="64" channel="0"/></Notes>'
const audio = '<Warps contentTimeUnit="seconds"><Warp time="0" contentTime="0"/><Warp time="8" contentTime="4"/><Audio duration="4" channels="1" sampleRate="4"><File path="ramp.wav"/></Audio></Warps>'
const project = (content = notes, attributes = '', extra = '') => Xml.parse(`<Project version="1.0"><Transport><Tempo value="120" unit="bpm"/></Transport><Structure>
    <Track id="track" contentType="${content === notes ? 'notes' : 'audio'}"><Channel id="channel" role="regular" destination="master"/></Track>
    <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>${extra}</Structure>
    <Arrangement><Lanes><Lanes track="track"><Clips><Clip time="0" duration="8" loopEnd="4" ${attributes}>${content}</Clip></Clips></Lanes></Lanes></Arrangement></Project>`, ProjectSchema)
const data = AudioData.create(4, 16, 1)
const resource = {uuid: UUID.generate(), name: "ramp.wav", path: "ramp.wav", buffer: new ArrayBuffer(0)}
const resources = {fromPath: vi.fn(() => resource), fromUUID: vi.fn(() => resource)}
const samples = {getOrCreate: () => ({data: Option.wrap(data)})} as unknown as SampleLoaderManager
const packer = {write: vi.fn((path: string, _buffer: ArrayBufferLike) => Xml.element({path}, FileReferenceSchema))}
const write = (skeleton: Awaited<ReturnType<typeof DawProjectImport.read>>['skeleton']) => DawProjectExporter.write(skeleton, samples, packer)
const xml = (schema: ProjectSchema) => Xml.pretty(Xml.toElement("Project", schema))
const audible = (skeleton: Awaited<ReturnType<typeof DawProjectImport.read>>['skeleton']) => skeleton.boxGraph.boxes().filter(box => box instanceof NoteRegionBox).flatMap(region => {
    const position = region.position.getValue(), complete = position + region.duration.getValue()
    const events = skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox && box.events.targetVertex.unwrap().box === region.events.targetVertex.unwrap().box)
    return [...LoopableRegion.locateLoops({position, complete, loopOffset: region.loopOffset.getValue(), loopDuration: region.loopDuration.getValue()}, position, complete)]
        .flatMap(loop => events.map(event => loop.rawStart + event.position.getValue()).filter(at => at >= loop.resultStart && at < loop.resultEnd))
}).sort((a, b) => a - b)
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})

it("B01 retains audible note starts across two offset loops", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
    skeleton.boxGraph.beginTransaction()
    region.loopOffset.setValue(q)
    skeleton.boxGraph.endTransaction()
    const imported = await DawProjectImport.read(Xml.parse(xml(write(skeleton)), ProjectSchema), resources)
    expect(audible(imported.skeleton)).toEqual(audible(skeleton))
    expect(audible(imported.skeleton)).toEqual([1, 3, 5, 7].map(at => at * q))
})
it("B01 refuses the unimplemented note event offset before packing", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    skeleton.boxGraph.beginTransaction()
    const region = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
    region.loopOffset.setValue(q)
    region.eventOffset.setValue(q)
    skeleton.boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/Unsupported note event offset/)
    expect(packer.write).not.toHaveBeenCalled()
})
it("B01 converts an absolute one-second source trim to two beats", async () => {
    const {skeleton} = await DawProjectImport.read(project(audio), resources)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    skeleton.boxGraph.beginTransaction()
    region.playMode.defer()
    region.timeBase.setValue(TimeBase.Seconds)
    region.duration.setValue(4)
    region.loopDuration.setValue(4)
    region.loopOffset.setValue(1)
    skeleton.boxGraph.endTransaction()
    const exported = write(skeleton)
    expect(xml(exported)).toContain('playStart="2"')
    const {skeleton: imported} = await DawProjectImport.read(Xml.parse(xml(exported), ProjectSchema), resources)
    expect((imported.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox).loopOffset.getValue()).toBe(2 * q)
})
it("B01 refuses an invalid audio loop before media packing", async () => {
    const {skeleton} = await DawProjectImport.read(project(audio), resources)
    skeleton.boxGraph.beginTransaction()
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    region.loopOffset.setValue(region.loopDuration.getValue())
    skeleton.boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/Unsupported audio export playback window/)
    expect(packer.write).not.toHaveBeenCalled()
})
