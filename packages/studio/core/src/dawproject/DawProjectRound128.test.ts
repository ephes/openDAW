import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {AudioData, LoopableRegion, PPQN, TimeBase} from "@opendaw/lib-dsp"
import {AudioRegionBox, AudioUnitBox, AuxSendBox, NoteClipBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox, ValueEventBox, ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {SampleLoaderManager} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
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
    const events = skeleton.boxGraph.boxes().filter((box): box is NoteEventBox => box instanceof NoteEventBox && box.events.targetVertex.unwrap().box === region.events.targetVertex.unwrap().box)
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

const aux = '<Track id="aux" contentType="audio"><Channel id="aux-channel" role="effect" destination="master"/></Track>'
it("B02 round-trips send destinations, pre/post, level, pan and disabled state", async () => {
    const source = xml(project(notes, '', aux)).replace(/<Channel[^>]*id="channel"[^>]*\/>/, `<Channel id="channel" role="regular" destination="master">
        <Sends><Send destination="aux-channel" type="pre"><Volume value="0.5" unit="linear"/><Pan value="0.25" unit="normalized"/></Send>
        <Send destination="aux-channel" type="post"><Volume value="0.25" unit="linear"/><Pan value="0.75" unit="normalized"/><Enable value="false"/></Send></Sends></Channel>`)
    const {skeleton} = await DawProjectImport.read(Xml.parse(source, ProjectSchema), resources)
    const exported = xml(write(skeleton))
    expect((exported.match(/<Send /g) ?? [])).toHaveLength(2)
    expect(exported).toContain('value="false"')
    const {skeleton: imported} = await DawProjectImport.read(Xml.parse(exported, ProjectSchema), resources)
    const sends = imported.boxGraph.boxes().filter(box => box instanceof AuxSendBox).sort((a, b) => a.index.getValue() - b.index.getValue())
    expect(sends).toHaveLength(2)
    expect(sends.map(box => box.routing.getValue())).toEqual([0, 1])
    expect(sends.map(box => box.sendGain.getValue())).toEqual(expect.arrayContaining([expect.closeTo(-6.0206, 3), expect.closeTo(-12.0412, 3)]))
    expect(sends.map(box => box.sendPan.getValue())).toEqual([-0.5, 0.5])
    expect(sends[0].targetBus.targetVertex.unwrap().box).toBe(sends[1].targetBus.targetVertex.unwrap().box)
    expect(sends.map(box => box.getField(7).getValue())).toEqual([true, false])
})
it("B02 keeps channel mute/solo independent from clip mute", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    skeleton.boxGraph.beginTransaction()
    const unit = skeleton.boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    unit.mute.setValue(true)
    unit.solo.setValue(true)
    skeleton.boxGraph.endTransaction()
    const {skeleton: imported} = await DawProjectImport.read(Xml.parse(xml(write(skeleton)), ProjectSchema), resources)
    const result = imported.boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    expect(result.mute.getValue()).toBe(true)
    expect(result.solo.getValue()).toBe(true)
    expect((imported.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox).mute.getValue()).toBe(false)
    expect(imported.mandatoryBoxes.primaryAudioUnitBox.mute.getValue()).toBe(false)
    expect(imported.mandatoryBoxes.primaryAudioUnitBox.solo.getValue()).toBe(false)
})

it("B03 refuses nonempty parameter regions before packing but keeps tempo automation", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const {boxGraph, mandatoryBoxes: {timelineBox}} = skeleton
    boxGraph.beginTransaction()
    const collection = ValueEventCollectionBox.create(boxGraph, UUID.generate())
    ValueEventBox.create(boxGraph, UUID.generate(), box => {box.events.refer(collection.events); box.value.setValue(0.5)})
    timelineBox.tempoTrack.events.refer(collection.owners)
    timelineBox.tempoTrack.enabled.setValue(true)
    boxGraph.endTransaction()
    expect(xml(write(skeleton))).toContain('TempoAutomation')
    packer.write.mockClear()
    boxGraph.beginTransaction()
    const unit = boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    const track = TrackBox.create(boxGraph, UUID.generate(), box => {box.tracks.refer(unit.tracks); box.target.refer(unit.volume); box.type.setValue(3); box.index.setValue(1)})
    ValueRegionBox.create(boxGraph, UUID.generate(), box => {box.regions.refer(track.regions); box.events.refer(collection.owners); box.duration.setValue(q); box.loopDuration.setValue(q)})
    boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/Unsupported parameter automation region/)
    expect(packer.write).not.toHaveBeenCalled()
})
it("B03 refuses launcher clips even without arrangement regions", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const {boxGraph} = skeleton
    boxGraph.beginTransaction()
    boxGraph.boxes().filter(box => box instanceof NoteRegionBox).forEach(box => box.delete())
    boxGraph.endTransaction()
    expect(() => write(skeleton)).not.toThrow()
    packer.write.mockClear()
    boxGraph.beginTransaction()
    const track = boxGraph.boxes().find(box => box instanceof TrackBox) as TrackBox
    const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
    NoteEventBox.create(boxGraph, UUID.generate(), box => {box.events.refer(collection.events)})
    NoteClipBox.create(boxGraph, UUID.generate(), box => {box.clips.refer(track.clips); box.events.refer(collection.owners); box.duration.setValue(q)})
    boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/Unsupported launcher clip/)
    expect(packer.write).not.toHaveBeenCalled()
})
