import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema, RealPointSchema} from "@opendaw/lib-dawproject"
import {PPQN, ValueEvent} from "@opendaw/lib-dsp"
import {InterpolationFieldAdapter, SampleLoaderManager, TempoGridCursor} from "@opendaw/studio-adapters"
import {ValueEventBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {UUID} from "@opendaw/lib-std"
import {DawProjectImport} from "./DawProjectImporter"
import {DawProjectExporter} from "./DawProjectExporter"

const q = PPQN.Quarter
const notes = '<Notes><Note time="0" duration="1" key="60" channel="0"/></Notes>'
const regular = '<Track id="track" contentType="notes"><Channel id="channel" role="regular" destination="master"/></Track>'
const master = '<Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>'
const source = (arrangement = '', structure = regular + master) => `<Project version="1.0"><Transport><Tempo value="120" unit="bpm"/></Transport><Structure>${structure}</Structure><Arrangement>${arrangement}</Arrangement></Project>`
const parse = (text: string) => Xml.parse(text, ProjectSchema)
const xml = (schema: ProjectSchema) => Xml.pretty(Xml.toElement('Project', schema))
const buffers = new Map<string, ArrayBuffer>()
const resources = {fromPath: vi.fn((path: string) => ({uuid: UUID.generate(), name: path, path, buffer: buffers.get(path)!})), fromUUID: vi.fn()}
const packer = {write: vi.fn((path: string, buffer: ArrayBufferLike) => {buffers.set(path, buffer as ArrayBuffer); return Xml.element({path}, FileReferenceSchema)})}
const samples = {} as SampleLoaderManager
const read = (text: string) => DawProjectImport.read(parse(text), resources)
const write = (skeleton: Awaited<ReturnType<typeof read>>['skeleton']) => DawProjectExporter.write(skeleton, samples, packer)
const tempo = '<TempoAutomation unit="bpm"><RealPoint time="0" value="120" interpolation="hold"/><RealPoint time="4" value="400" interpolation="linear"/></TempoAutomation>'
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); buffers.clear()})

it('B01 imports literal BPM independently of the editor display range', async () => {
    const {skeleton} = await read(source(tempo))
    const events = skeleton.boxGraph.boxes().filter(box => box instanceof ValueEventBox).sort((a, b) => a.position.getValue() - b.position.getValue())
    expect(events.map(box => box.value.getValue())).toEqual([120, 400])
    expect(events.map(box => box.position.getValue())).toEqual([0, 4 * q])
    const values = (): ValueEvent[] => events.map(box => ({type: 'value-event', position: box.position.getValue(), index: 0, value: box.value.getValue(), interpolation: InterpolationFieldAdapter.read(box.interpolation)}))
    expect(new TempoGridCursor().integrate(values(), 0, 4 * q, 90)).toBeCloseTo(2)
    expect(new TempoGridCursor().integrate(values(), 4 * q, 8 * q, 90)).toBeCloseTo(0.6)
    skeleton.boxGraph.beginTransaction()
    skeleton.mandatoryBoxes.timelineBox.tempoTrack.minBpm.setValue(30)
    skeleton.mandatoryBoxes.timelineBox.tempoTrack.maxBpm.setValue(999)
    skeleton.boxGraph.endTransaction()
    expect(new TempoGridCursor().integrate(values(), 0, 4 * q, 90)).toBeCloseTo(2)
})
it.each([0, -1, 1e40, 1e-50])('B01 refuses unrepresentable tempo %s before construction', async value => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source(`<TempoAutomation unit="bpm"><RealPoint time="0" value="${value}"/></TempoAutomation>`))).rejects.toThrow(/tempo.*BPM/i)
    expect(begin).not.toHaveBeenCalled()
})
it('B01 exports independently constructed native BPM events literally', async () => {
    const {skeleton} = await read(source())
    const {boxGraph, mandatoryBoxes: {timelineBox}} = skeleton
    boxGraph.beginTransaction()
    const collection = ValueEventCollectionBox.create(boxGraph, UUID.generate())
    timelineBox.tempoTrack.events.refer(collection.owners)
    ;[120, 180].forEach((value, index) => ValueEventBox.create(boxGraph, UUID.generate(), box => {
        box.events.refer(collection.events); box.position.setValue(index * 4 * q); box.value.setValue(value)
    }))
    boxGraph.endTransaction()
    const result = write(skeleton).arrangement!.tempoAutomation!.points!
    expect(result.map(point => ({time: point.time, value: (point as RealPointSchema).value}))).toEqual([{time: 0, value: 120}, {time: 4, value: 180}])
    expect(xml(write(skeleton))).toContain('value="180"')
    boxGraph.beginTransaction()
    const event = boxGraph.boxes().find(box => box instanceof ValueEventBox) as ValueEventBox
    event.value.setValue(0)
    boxGraph.endTransaction()
    packer.write.mockClear()
    expect(() => write(skeleton)).toThrow(/tempo.*BPM/i)
    expect(packer.write).not.toHaveBeenCalled()
})
