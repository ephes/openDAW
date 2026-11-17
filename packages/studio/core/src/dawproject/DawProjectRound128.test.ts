import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {FileReferenceSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {AudioData, FadingEnvelope, LoopableRegion, PPQN, TimeBase} from "@opendaw/lib-dsp"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, AuxSendBox, DelayDeviceBox, SelectionBox, FoldDeviceBox, NanoDeviceBox, PitchDeviceBox, NoteClipBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox, ValueEventBox, ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {SampleLoaderManager} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {ByteArrayOutput, Option, UUID} from "@opendaw/lib-std"
import {Box} from "@opendaw/lib-box"
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
const packedResources = new Map<string, ArrayBuffer>()
const resources = {fromPath: vi.fn((path: string) => ({...resource, buffer: packedResources.get(path) ?? resource.buffer})), fromUUID: vi.fn(() => resource)}
const samples = {getOrCreate: () => ({data: Option.wrap(data)})} as unknown as SampleLoaderManager
const packer = {write: vi.fn((path: string, buffer: ArrayBufferLike) => {packedResources.set(path, buffer as ArrayBuffer); return Xml.element({path}, FileReferenceSchema)})}
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

it.each([['playCount', 2], ['playCurve', 0.5], ['cent', 12], ['chance', 50]] as const)("B04 refuses expressive note %s before packing", async (field, value) => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    skeleton.boxGraph.beginTransaction()
    const note = skeleton.boxGraph.boxes().find(box => box instanceof NoteEventBox) as NoteEventBox
    note[field].setValue(value)
    skeleton.boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/Unsupported expressive note/)
    expect(packer.write).not.toHaveBeenCalled()
})
it.each(['gain', 'inSlope', 'outSlope'] as const)("B04 refuses unsupported audio %s before packing", async field => {
    const {skeleton} = await DawProjectImport.read(project(audio), resources)
    skeleton.boxGraph.beginTransaction()
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    if (field === 'gain') {region.gain.setValue(-6)} else {
        region.fading.in.setValue(q)
        region.fading.out.setValue(q)
        region.fading.inSlope.setValue(0.5)
        region.fading.outSlope.setValue(0.5)
        region.fading[field].setValue(0.25)
    }
    skeleton.boxGraph.endTransaction()
    expect(() => write(skeleton)).toThrow(/Unsupported audio (gain|fade curve)/)
    expect(packer.write).not.toHaveBeenCalled()
})
it("B04 exports linear fades in explicit beat units", async () => {
    const {skeleton} = await DawProjectImport.read(project(audio), resources)
    skeleton.boxGraph.beginTransaction()
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    region.fading.in.setValue(q)
    region.fading.out.setValue(2 * q)
    region.fading.inSlope.setValue(0.5)
    region.fading.outSlope.setValue(0.5)
    skeleton.boxGraph.endTransaction()
    const exported = xml(write(skeleton))
    expect(exported).toContain('fadeTimeUnit="beats"')
    expect(exported).toContain('fadeInTime="1"')
    expect(exported).toContain('fadeOutTime="2"')
})

it("B05 restores native Nano and ordered effect parameters with valid hosts", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const {boxGraph} = skeleton
    const unit = boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    boxGraph.beginTransaction()
    unit.input.pointerHub.incoming().forEach(({box}) => box.delete())
    NanoDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.input); box.release.setValue(0.75); box.volume.setValue(-9)})
    DelayDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.index.setValue(1); box.feedback.setValue(0.25)})
    FoldDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.index.setValue(0); box.drive.setValue(12)})
    PitchDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.midiEffects); box.index.setValue(0)})
    boxGraph.endTransaction()
    const packed = new Map<string, ArrayBuffer>()
    const schema = DawProjectExporter.write(skeleton, samples, {write: (path, bytes) => {packed.set(path, bytes as ArrayBuffer); return Xml.element({path}, FileReferenceSchema)}})
    const provider = {...resources, fromPath: (path: string) => ({...resource, path, buffer: packed.get(path)!})}
    const {skeleton: imported} = await DawProjectImport.read(Xml.parse(xml(schema), ProjectSchema), provider)
    const nano = imported.boxGraph.boxes().find(box => box instanceof NanoDeviceBox) as NanoDeviceBox
    expect(nano).toBeDefined()
    expect(nano.release.getValue()).toBe(0.75)
    expect(nano.volume.getValue()).toBe(-9)
    const host = nano.host.targetVertex.unwrap().box as AudioUnitBox
    const delays = imported.boxGraph.boxes().filter(box => box instanceof DelayDeviceBox).sort((a, b) => a.index.getValue() - b.index.getValue())
    expect(delays.map(box => box.feedback.getValue())).toEqual([0.25])
    const chain = host.audioEffects.pointerHub.incoming().map(({box}) => box as DelayDeviceBox | FoldDeviceBox).sort((a, b) => a.index.getValue() - b.index.getValue())
    expect(chain.map(box => box.name)).toEqual(['FoldDeviceBox', 'DelayDeviceBox'])
    expect((chain[0] as FoldDeviceBox).drive.getValue()).toBe(12)
    expect(delays.every(box => box.host.targetVertex.unwrap().box === host)).toBe(true)
    expect(imported.boxGraph.boxes().filter(box => box instanceof PitchDeviceBox)).toHaveLength(1)
    expect(() => imported.boxGraph.verifyPointers()).not.toThrow()
})
it("B05 refuses malformed native state before reading audio assets", async () => {
    const source = xml(project(audio)).replace(/<Channel[^>]*id="channel"[^>]*\/>/, '<Channel id="channel" role="regular" destination="master"><Devices><BuiltinDevice deviceVendor="openDAW" deviceID="NanoDeviceBox" deviceRole="instrument"><State path="bad.preset"/></BuiltinDevice></Devices></Channel>')
    await expect(DawProjectImport.read(Xml.parse(source, ProjectSchema), resources)).rejects.toThrow(/Unsupported native device state/)
    expect(resources.fromPath).toHaveBeenCalledTimes(1)
    expect(resources.fromPath).toHaveBeenCalledWith('bad.preset')
})
it("B05 refuses generic parameter Points before graph allocation", async () => {
    const source = xml(project()).replace('<Clips>', '<Points><Target parameter="volume"/><RealPoint time="0" value="0.5"/></Points><Clips>')
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(DawProjectImport.read(Xml.parse(source, ProjectSchema), resources)).rejects.toThrow(/Unsupported parameter automation lane/)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})

it("B05 refuses native dependent resources instead of substituting a sampler", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const {boxGraph} = skeleton
    boxGraph.beginTransaction()
    const unit = boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    unit.input.pointerHub.incoming().forEach(({box}) => box.delete())
    const file = AudioFileBox.create(boxGraph, UUID.generate(), box => {box.endInSeconds.setValue(4)})
    NanoDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.input); box.file.refer(file)})
    boxGraph.endTransaction()
    const exported = Xml.parse(xml(write(skeleton)), ProjectSchema)
    resources.fromPath.mockClear()
    await expect(DawProjectImport.read(exported, resources)).rejects.toThrow(/Unsupported native device state/)
    expect(resources.fromPath).toHaveBeenCalledTimes(1)
    expect(resources.fromPath.mock.calls[0][0]).toMatch(/^presets\//)
})

it.each([notes, audio])("B06 refuses an explicit source playStop before graph allocation", async content => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(DawProjectImport.read(project(content, 'playStop="1"'), resources)).rejects.toThrow(/Unsupported clip playStop/)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it("B06 imports and round-trips linear audio fades with the same edge envelope", async () => {
    const {skeleton} = await DawProjectImport.read(project(audio, 'fadeTimeUnit="beats" fadeInTime="1" fadeOutTime="2"'), resources)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    const fading = (box: AudioRegionBox) => ({in: box.fading.in.getValue(), out: box.fading.out.getValue(), inSlope: box.fading.inSlope.getValue(), outSlope: box.fading.outSlope.getValue()})
    expect(fading(region)).toEqual({in: q, out: 2 * q, inSlope: 0.5, outSlope: 0.5})
    const {skeleton: imported} = await DawProjectImport.read(Xml.parse(xml(write(skeleton)), ProjectSchema), resources)
    const result = imported.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    const edge = [0, 0.5, 1, 6, 7, 8].map(at => FadingEnvelope.gainAt(at * q, result.duration.getValue(), fading(result)))
    expect(edge).toEqual([0, 0.5, 1, 1, 0.5, 0])
})
it.each([
    'fadeTimeUnit="seconds" fadeInTime="1"', 'fadeInTime="1"',
    'fadeTimeUnit="beats" fadeInTime="-1"', 'fadeTimeUnit="beats" fadeOutTime="9"'
])("B06 refuses unsupported or invalid fades before graph/assets: %s", async attributes => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    await expect(DawProjectImport.read(project(audio, attributes), resources)).rejects.toThrow(/Unsupported clip fade/)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it("B06 refuses note fades rather than ignoring them", async () => {
    await expect(DawProjectImport.read(project(notes, 'fadeTimeUnit="beats" fadeInTime="1"'), resources)).rejects.toThrow(/Unsupported note clip fade/)
})

it.each(['fadeInTime="NaN"', 'fadeOutTime="Infinity"'])("B06 rejects nonfinite fades at XML admission: %s", attributes => {
    expect(() => project(audio, attributes)).toThrow(/Invalid XML attribute 'fade/)
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it("B06 refuses envelope state on the otherwise supported inner wrapper", async () => {
    const content = `<Clips><Clip time="0" duration="8" fadeTimeUnit="beats" fadeInTime="1">${audio}</Clip></Clips>`
    await expect(DawProjectImport.read(project(content), resources)).rejects.toThrow(/Unsupported nested clip fades/)
    expect(resources.fromPath).not.toHaveBeenCalled()
})

it("B05 refuses native instruments on bus channels instead of ignoring their state", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const exported = xml(write(skeleton)).replace('role="regular"', 'role="effect"')
    resources.fromPath.mockClear()
    await expect(DawProjectImport.read(Xml.parse(exported, ProjectSchema), resources)).rejects.toThrow(/Unsupported native device state/)
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it("B05 catches parameter Points inside otherwise unread clip lanes", async () => {
    const begin = vi.spyOn(BoxGraph.prototype, 'beginTransaction')
    const content = '<Lanes><Points><Target parameter="volume"/><RealPoint time="0" value="0.5"/></Points></Lanes>'
    await expect(DawProjectImport.read(project(content), resources)).rejects.toThrow(/Unsupported parameter automation lane/)
    expect(begin).not.toHaveBeenCalled()
    expect(resources.fromPath).not.toHaveBeenCalled()
})
it("B05 skips the structural AudioBusBox that earlier exports wrote on bus channels", async () => {
    const legacy = '<BuiltinDevice deviceVendor="openDAW" deviceID="AudioBusBox" deviceRole="instrument"><State path="presets/legacy-bus"/></BuiltinDevice>'
    const source = xml(project(notes, '', aux)).replace(/<Channel id="master" role="master"\/>/, `<Channel id="master" role="master"><Devices>${legacy}</Devices></Channel>`)
        .replace(/<Channel([^>]*)id="aux-channel"([^>]*)\/>/, `<Channel$1id="aux-channel"$2><Devices>${legacy}</Devices></Channel>`)
    expect((source.match(/deviceID="AudioBusBox"/g) ?? [])).toHaveLength(2)
    const {skeleton} = await DawProjectImport.read(Xml.parse(source, ProjectSchema), resources)
    expect(resources.fromPath).not.toHaveBeenCalled()
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof AudioUnitBox)).toHaveLength(3)
})
it("B05 round-trips a selected native device with an empty automation lane on its parameter", async () => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const {boxGraph} = skeleton
    const unit = boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    const [user] = skeleton.mandatoryBoxes.userInterfaceBoxes
    boxGraph.beginTransaction()
    const delay = DelayDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.index.setValue(0); box.feedback.setValue(0.25)})
    SelectionBox.create(boxGraph, UUID.generate(), box => {box.selection.refer(user.selection); box.selectable.refer(delay)})
    TrackBox.create(boxGraph, UUID.generate(), box => {box.tracks.refer(unit.tracks); box.target.refer(delay.feedback); box.index.setValue(1)})
    boxGraph.endTransaction()
    const {skeleton: imported} = await DawProjectImport.read(Xml.parse(xml(write(skeleton)), ProjectSchema), resources)
    const delays = imported.boxGraph.boxes().filter(box => box instanceof DelayDeviceBox)
    expect(delays.map(box => box.feedback.getValue())).toEqual([0.25])
    expect(imported.boxGraph.boxes().filter(box => box instanceof SelectionBox)).toHaveLength(0)
    expect(() => imported.boxGraph.verifyPointers()).not.toThrow()
})
// Preset layout written before device export excluded selections and automation lanes.
const legacyPreset = (device: Box): ArrayBuffer => {
    const output = ByteArrayOutput.create()
    output.writeString("openDAW:device")
    output.writeInt(1)
    const writeBox = (box: Box) => {
        UUID.toDataOutput(output, box.address.uuid)
        output.writeString(box.name)
        const bytes = box.toArrayBuffer()
        output.writeInt(bytes.byteLength)
        output.writeBytes(new Int8Array(bytes))
    }
    const dependencies = Array.from(device.graph.dependenciesOf(device).boxes)
    writeBox(device)
    output.writeInt(dependencies.length)
    dependencies.forEach(writeBox)
    return output.toArrayBuffer() as ArrayBuffer
}
const legacyRoundTrip = async (withEvent: boolean) => {
    const {skeleton} = await DawProjectImport.read(project(), resources)
    const {boxGraph} = skeleton
    const unit = boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    const [user] = skeleton.mandatoryBoxes.userInterfaceBoxes
    boxGraph.beginTransaction()
    const delay = DelayDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.index.setValue(0); box.feedback.setValue(0.25)})
    SelectionBox.create(boxGraph, UUID.generate(), box => {box.selection.refer(user.selection); box.selectable.refer(delay)})
    const track = TrackBox.create(boxGraph, UUID.generate(), box => {box.tracks.refer(unit.tracks); box.target.refer(delay.feedback); box.type.setValue(3); box.index.setValue(1)})
    boxGraph.endTransaction()
    const exported = xml(write(skeleton))
    boxGraph.beginTransaction()
    const collection = ValueEventCollectionBox.create(boxGraph, UUID.generate())
    if (withEvent) {ValueEventBox.create(boxGraph, UUID.generate(), box => {box.events.refer(collection.events); box.value.setValue(0.5)})}
    ValueRegionBox.create(boxGraph, UUID.generate(), box => {box.regions.refer(track.regions); box.events.refer(collection.owners); box.duration.setValue(q); box.loopDuration.setValue(q)})
    boxGraph.endTransaction()
    const legacy = legacyPreset(delay)
    const path = `presets/${UUID.toString(delay.address.uuid)}`
    const provider = {...resources, fromPath: (at: string) => ({...resource, path: at, buffer: at === path ? legacy : packedResources.get(at)!})}
    return DawProjectImport.read(Xml.parse(exported, ProjectSchema), provider)
}
it("B05 drops selection and empty automation lane records from earlier native device exports", async () => {
    const {skeleton: imported} = await legacyRoundTrip(false)
    expect(imported.boxGraph.boxes().filter(box => box instanceof DelayDeviceBox).map(box => box.feedback.getValue())).toEqual([0.25])
    expect(imported.boxGraph.boxes().filter(box => box instanceof SelectionBox || box instanceof ValueRegionBox)).toHaveLength(0)
    expect(() => imported.boxGraph.verifyPointers()).not.toThrow()
})
it("B05 refuses earlier native device exports whose automation lane has events", async () => {
    await expect(legacyRoundTrip(true)).rejects.toThrow(/Unsupported native device state/)
})
