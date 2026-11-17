import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema, RealPointSchema, TrackSchema} from "@opendaw/lib-dawproject"
import {PPQN, ValueEvent} from "@opendaw/lib-dsp"
import {InterpolationFieldAdapter, InstrumentFactories, ProjectSkeleton, SampleLoaderManager, TempoGridCursor, TrackType} from "@opendaw/studio-adapters"
import {ApparatDeviceBox, AudioUnitBox, AuxSendBox, MarkerBox, MIDIOutputDeviceBox, NoteEventBox, NoteRegionBox, SoundfontDeviceBox, TrackBox, ValueEventBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
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
const read = async (text: string) => DawProjectImport.read(parse(text), resources)
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

it.each(['time="12" duration="4"', 'time="0" duration="1"', 'time="0" duration="4" playStart="2"', 'time="0" duration="4" loopEnd="2"', 'time="0" duration="4" enable="false"'])(
    'B05 refuses nontransparent nested clip coordinates: %s', async attributes => {
        const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
        await expect(read(source(lanes(`<Clips><Clip ${attributes}>${notes}</Clip></Clips>`)))).rejects.toThrow(/nested clip coordinates/i)
        expect(begin).not.toHaveBeenCalled()
        expect(resources.fromPath).not.toHaveBeenCalled()
    })
it('B05 retains a transparent nested wrapper at its independent audible position', async () => {
    const {skeleton} = await read(source(lanes(`<Clips><Clip time="0" duration="4">${notes}</Clip></Clips>`)))
    const region = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
    const note = skeleton.boxGraph.boxes().find(box => box instanceof NoteEventBox) as NoteEventBox
    expect(region.position.getValue() + note.position.getValue()).toBe(2 * q)
    expect(region.duration.getValue()).toBe(4 * q)
})
it.each(['', 'time="garbage"', 'time="Infinity"', 'time="NaN"', 'time="1e400"', 'time="3000000"', 'time="-1"', 'time="0.0001"', 'time="1e-20"'])(
    'B05 refuses invalid automation coordinates before construction: %s', async time => {
        const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
        for (const [tag, point] of [['TempoAutomation', `<RealPoint ${time} value="120"/>`], ['TimeSignatureAutomation', `<TimeSignaturePoint ${time} numerator="3" denominator="4"/>`]]) {
            await expect(read(source(`<${tag}>${point}</${tag}>`))).rejects.toThrow(/time|coordinate|attribute/i)
        }
        expect(begin).not.toHaveBeenCalled()
        expect(resources.fromPath).not.toHaveBeenCalled()
    })
it('B05 stores legitimate zero and fractional pulse-representable point times', async () => {
    const automation = '<TempoAutomation><RealPoint time="0" value="120"/><RealPoint time="0.5" value="180"/></TempoAutomation><TimeSignatureAutomation><TimeSignaturePoint time="0" numerator="1" denominator="8"/><TimeSignaturePoint time="0.5" numerator="3" denominator="4"/></TimeSignatureAutomation>'
    const {skeleton} = await read(source(automation))
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof ValueEventBox).map(box => box.position.getValue()).sort((a, b) => a - b)).toEqual([0, q / 2])
    const exported = write(skeleton).arrangement!
    expect(exported.timeSignatureAutomation!.points!.map(point => point.time)).toEqual([0, 0.5])
})
it('B05 refuses signature times that cannot be represented as native whole bars', async () => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source('<TimeSignatureAutomation><TimeSignaturePoint time="0.5" numerator="3" denominator="4"/></TimeSignatureAutomation>'))).rejects.toThrow(/signature.*time/i)
    expect(begin).not.toHaveBeenCalled()
})

const markerValues = (skeleton: Awaited<ReturnType<typeof read>>['skeleton']) => skeleton.boxGraph.boxes()
    .filter(box => box instanceof MarkerBox).sort((a, b) => a.position.getValue() - b.position.getValue()).map(box => [box.position.getValue(), box.label.getValue(), box.hue.getValue(), box.plays.getValue()])
it('B06 imports labeled beat markers and preserves their native state on save/reopen', async () => {
    const {skeleton} = await read(source('<Markers timeUnit="beats"><Marker time="2" name="Verse" color="#ff3333"/><Marker time="4.5" name="Chorus" color="#33ff33"/></Markers>'))
    expect(markerValues(skeleton)).toEqual([[2 * q, 'Verse', 0, 1], [4.5 * q, 'Chorus', 120, 1]])
    const reopened = ProjectSkeleton.decode(ProjectSkeleton.encode(skeleton.boxGraph))
    expect(markerValues(reopened)).toEqual(markerValues(skeleton))
    expect(() => reopened.boxGraph.verifyPointers()).not.toThrow()
})
it.each([
    '<Markers timeUnit="seconds"><Marker time="2" name="Verse"/></Markers>',
    '<Markers><Marker time="2" comment="cannot retain"/></Markers>',
    '<Markers><Marker time="2" color="#abcdef"/></Markers>',
    '<Markers><Marker time="2" color="garbage"/></Markers>',
    '<Markers><Marker time="-1"/></Markers>',
    '<Markers><Marker time="3000000"/></Markers>',
    '<Markers><Marker time="0.0001"/></Markers>'
])('B06 refuses unrepresentable marker timing or attributes before construction', async markers => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(read(source(markers))).rejects.toThrow(/marker|coordinate|time unit/i)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it('B06 accepts an empty marker collection', async () => {
    const {skeleton} = await read(source('<Markers/>'))
    expect(markerValues(skeleton)).toEqual([])
    expect(write(skeleton).arrangement!.markers).toBeUndefined()
})
it('B06 exports independently constructed native markers as literal beat coordinates', async () => {
    const {skeleton} = await read(source(tempo))
    const {boxGraph, mandatoryBoxes: {timelineBox}} = skeleton
    boxGraph.beginTransaction()
    MarkerBox.create(boxGraph, UUID.generate(), box => {box.track.refer(timelineBox.markerTrack.markers); box.position.setValue(2 * q); box.label.setValue('Verse'); box.hue.setValue(120)})
    boxGraph.endTransaction()
    const element = Xml.toElement('Project', write(skeleton))
    const marker = element.querySelector('Arrangement > Markers > Marker')!
    expect(marker).not.toBeNull()
    expect(marker.getAttribute('time')).toBe('2')
    expect(marker.getAttribute('name')).toBe('Verse')
    expect(marker.getAttribute('color')).toBe('#33ff33')
    expect(marker.parentElement!.getAttribute('timeUnit')).toBe('beats')
    const sequence = ['TimeSignatureAutomation', 'TempoAutomation', 'Markers', 'Lanes']
    const children = Array.from(element.querySelector('Arrangement')!.children, child => child.tagName)
    expect(children).toContain('Markers')
    expect(children).toEqual([...children].sort((a, b) => sequence.indexOf(a) - sequence.indexOf(b)))
})
it.each([0, 2])('B06 refuses native repeat play count %s before packing resources', async plays => {
    const {skeleton} = await read(source())
    const {boxGraph, mandatoryBoxes: {timelineBox}} = skeleton
    boxGraph.beginTransaction()
    MarkerBox.create(boxGraph, UUID.generate(), box => {box.track.refer(timelineBox.markerTrack.markers); box.plays.setValue(plays)})
    boxGraph.endTransaction()
    packer.write.mockClear()
    expect(() => write(skeleton)).toThrow(/marker.*repeat/i)
    expect(packer.write).not.toHaveBeenCalled()
})
it('B06 refuses a disabled nonempty native marker track before packing', async () => {
    const {skeleton} = await read(source())
    const {boxGraph, mandatoryBoxes: {timelineBox}} = skeleton
    boxGraph.beginTransaction()
    timelineBox.markerTrack.enabled.setValue(false)
    MarkerBox.create(boxGraph, UUID.generate(), box => box.track.refer(timelineBox.markerTrack.markers))
    boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/marker track/i)
    expect(packer.write).not.toHaveBeenCalled()
})

it('B05/B06 retains native integer pulses through floating beat serialization', async () => {
    const {skeleton} = await read(source(`<TempoAutomation><RealPoint time="${31 / q}" value="120"/><RealPoint time="${123 / q}" value="180"/></TempoAutomation>`))
    const positions = skeleton.boxGraph.boxes().filter(box => box instanceof ValueEventBox).map(box => box.position.getValue()).sort((a, b) => a - b)
    expect(positions).toEqual([31, 123])
    skeleton.boxGraph.beginTransaction()
    MarkerBox.create(skeleton.boxGraph, UUID.generate(), box => {
        box.track.refer(skeleton.mandatoryBoxes.timelineBox.markerTrack.markers); box.position.setValue(31)
    })
    skeleton.boxGraph.endTransaction()
    const result = await read(xml(write(skeleton)))
    expect(markerValues(result.skeleton)[0][0]).toBe(31)
})
