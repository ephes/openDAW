import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema, RealPointSchema, TrackSchema} from "@opendaw/lib-dawproject"
import {PPQN, ValueEvent} from "@opendaw/lib-dsp"
import {InterpolationFieldAdapter, InstrumentFactories, SampleLoaderManager, TempoGridCursor, TrackType} from "@opendaw/studio-adapters"
import {ApparatDeviceBox, AudioUnitBox, AuxSendBox, MIDIOutputDeviceBox, NoteEventBox, NoteRegionBox, SoundfontDeviceBox, TrackBox, ValueEventBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {UUID} from "@opendaw/lib-std"
import {DawProjectImport} from "./DawProjectImporter"
import {DawProjectExporter} from "./DawProjectExporter"
import {DeviceIO} from "./DeviceIO"

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

const aux = '<Track id="aux" contentType="audio"><Channel id="aux-channel" role="effect"/></Track>'
const primarySend = master.replace('role="master"/>', 'role="master"><Sends><Send destination="aux-channel" type="pre"><Volume value="0.5" unit="linear"/><Pan value="0.25" unit="normalized"/><Enable value="false"/></Send></Sends></Channel>')
it('B02 retains primary sends including forward targets and all send state', async () => {
    const {skeleton} = await read(source('', regular + primarySend + aux))
    const check = (graph: BoxGraph) => {
        const sends = graph.boxes().filter(box => box instanceof AuxSendBox)
        expect(sends).toHaveLength(1)
        const send = sends[0]
        expect(send.routing.getValue()).toBe(0)
        expect(send.enabled.getValue()).toBe(false)
        expect(send.sendGain.getValue()).toBeCloseTo(-6.0206)
        expect(send.sendPan.getValue()).toBe(-0.5)
        expect(send.targetBus.targetVertex.unwrap().box.name).toBe('AudioBusBox')
    }
    check(skeleton.boxGraph)
    const exported = write(skeleton)
    check((await read(xml(exported))).skeleton.boxGraph)
})
it('B02 refuses primary feedback routing before constructing a graph', async () => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source('', primarySend + aux.replace('role="effect"', 'role="effect" destination="master"')))).rejects.toThrow(/feedback routing/i)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it.each([
    regular.replace('destination="master"', 'destination="missing"'),
    regular.replace('destination="master"', 'destination="channel"'),
    regular.replace('role="regular" destination="master"/>', 'role="regular" destination="master"><Sends><Send destination="missing"/></Sends></Channel>'),
    regular.replace('role="regular" destination="master"/>', 'role="regular" destination="master"><Sends><Send destination="track"/></Sends></Channel>')
])('B02 refuses unknown or wrong-kind declared destinations before construction', async track => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source('', track + master))).rejects.toThrow(/routing destination/i)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it('B02 keeps intentionally absent outputs disconnected', async () => {
    const {skeleton} = await read(source('', regular.replace(' destination="master"', '') + master + aux))
    const units = skeleton.boxGraph.boxes().filter((box): box is AudioUnitBox => box instanceof AudioUnitBox && box !== skeleton.mandatoryBoxes.primaryAudioUnitBox)
    expect(units).toHaveLength(2)
    expect(units.every(box => box.output.targetVertex.isEmpty())).toBe(true)
})

const lanes = (content = notes, track = 'track') => `<Lanes><Lanes track="${track}"><Clips><Clip time="2" duration="4">${content}</Clip></Clips></Lanes></Lanes>`
it.each(['regular', 'effect', 'master'])('B03 traverses child tracks under a %s parent', async role => {
    const child = regular.replace('id="track"', 'id="child"').replace('id="channel"', 'id="child-channel"')
    const parent = `<Track id="parent" contentType="${role === 'master' ? 'tracks' : 'notes'}"><Channel id="parent-channel" role="${role}" destination="master"/>${child}</Track>`
    const {skeleton} = await read(source(lanes(notes, 'child'), parent + master))
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof AudioUnitBox)).toHaveLength(3)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof NoteRegionBox)).toHaveLength(1)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox)).toHaveLength(1)
    expect(() => skeleton.boxGraph.verifyPointers()).not.toThrow()
})
it.each([
    ['MIDIOutput', MIDIOutputDeviceBox], ['Apparat', ApparatDeviceBox], ['Soundfont', SoundfontDeviceBox]
] as const)('B03 uses the native %s instrument content contract in import and export', async (name, deviceType) => {
    const {skeleton} = await read(source())
    const {boxGraph} = skeleton
    const unit = boxGraph.boxes().find((box): box is AudioUnitBox => box instanceof AudioUnitBox && box !== skeleton.mandatoryBoxes.primaryAudioUnitBox)!
    boxGraph.beginTransaction()
    unit.input.pointerHub.incoming().forEach(({box}) => box.delete())
    const device = deviceType.create(boxGraph, UUID.generate(), box => box.host.refer(unit.input))
    boxGraph.endTransaction()
    buffers.set('native', DeviceIO.exportDevice(device) as ArrayBuffer)
    const independent = regular.replace('destination="master"/>', `destination="master"><Devices><BuiltinDevice deviceVendor="openDAW" deviceID="${name}DeviceBox" deviceRole="instrument"><State path="native"/></BuiltinDevice></Devices></Channel>`)
    const imported = (await read(source(lanes(), independent + master))).skeleton
    expect(imported.boxGraph.boxes().filter(box => box instanceof TrackBox).map(box => box.type.getValue())).toEqual([InstrumentFactories.Named[name].trackType])
    expect(InstrumentFactories.Named[name].trackType).toBe(TrackType.Notes)
    const exported = write(skeleton)
    expect((exported.structure[0] as TrackSchema).contentType).toBe('notes')
    expect(xml(write(imported))).toContain('contentType="notes"')
})

it('B04 traverses nested arrangement lanes with inherited tracks and explicit overrides', async () => {
    const second = regular.replace('id="track"', 'id="second"').replace('id="channel"', 'id="second-channel"')
    const clip = `<Clips><Clip time="2" duration="4">${notes}</Clip></Clips>`
    const nested = `<Lanes track="track"><Lanes><Lanes>${clip}<Lanes track="second">${clip}</Lanes></Lanes></Lanes></Lanes>`
    const {skeleton} = await read(source(nested, regular + second + master))
    const regions = skeleton.boxGraph.boxes().filter(box => box instanceof NoteRegionBox)
    expect(regions).toHaveLength(2)
    expect(regions.map(box => [box.position.getValue(), box.duration.getValue()])).toEqual([[2 * q, 4 * q], [2 * q, 4 * q]])
    const hosts = regions.map(box => (box.regions.targetVertex.unwrap().box as TrackBox).tracks.targetVertex.unwrap().box)
    expect(new Set(hosts).size).toBe(2)
    const flat = (await read(source(`<Lanes><Lanes track="track">${clip}</Lanes><Lanes track="second">${clip}</Lanes></Lanes>`, regular + second + master))).skeleton
    expect(flat.boxGraph.boxes().filter(box => box instanceof NoteEventBox).map(box => box.pitch.getValue())).toEqual(
        skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox).map(box => box.pitch.getValue()))
})
it('B04 rejects an unknown nested track identity before graph construction', async () => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source(`<Lanes track="track"><Lanes><Lanes track="missing"><Clips><Clip time="0" duration="4">${notes}</Clip></Clips></Lanes></Lanes></Lanes>`))).rejects.toThrow(/track reference/i)
    expect(begin).not.toHaveBeenCalled()
})
it.each([
    `<Notes id="shared"><Note time="0" duration="1" key="60" channel="0"/></Notes>`,
    `<Notes id="shared"/><Notes id="shared"/>`,
    '<Clips id="shared"><Clip reference="shared"/></Clips>',
    ''
])('B04 refuses clip references explicitly before publishing a partial arrangement', async shared => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    const clip = `<Clips><Clip time="0" duration="4">${shared}</Clip><Clip time="4" duration="4" reference="shared"/></Clips>`
    await expect(read(source(`<Lanes><Lanes track="track">${clip}</Lanes></Lanes>`))).rejects.toThrow(/clip reference/i)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it('B04 refuses lanes inside clip content instead of accepting an ignored subtree', async () => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source(lanes('<Lanes><Lanes/></Lanes>')))).rejects.toThrow(/clip lane/i)
    expect(begin).not.toHaveBeenCalled()
})
