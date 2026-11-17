import {expect, it} from "vitest"
import JSZip from "jszip"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, DelayDeviceBox, PitchDeviceBox} from "@opendaw/studio-boxes"
import {DeviceBoxUtils, SampleLoaderManager} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {Option, UUID} from "@opendaw/lib-std"
import {Xml} from "@opendaw/lib-xml"
import {MetaDataSchema} from "@opendaw/lib-dawproject"
import {DawProject} from "./DawProject"
import {DawProjectImport} from "./DawProjectImporter"

it.each(["same", "../folder/./same"])("round-trips distinct same-named samples safely: %s", async name => {
    const data = [AudioData.create(4, 16, 1), AudioData.create(4, 16, 1)]
    data.forEach((audio, index) => audio.frames[0].fill((index + 1) / 4))
    const clip = (path: string, time: number) => `<Clip time="${time}" duration="8" name="clip-${time}"><Warps contentTimeUnit="seconds">
        <Warp time="0" contentTime="0"/><Warp time="8" contentTime="4"/><Audio duration="4" channels="1" sampleRate="4"><File path="${path}"/></Audio></Warps></Clip>`
    const bytes = await new JSZip().file("project.xml", `<Project version="1.0"><Structure>
        <Track id="audio" contentType="audio"><Channel id="channel" role="regular" destination="master"/></Track>
        <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>
        </Structure><Arrangement><Lanes><Lanes track="audio"><Clips>${clip("a.wav", 0)}${clip("b.wav", 8)}</Clips></Lanes></Lanes></Arrangement></Project>`)
        .file("a.wav", WavFile.encodeFloats(data[0])).file("b.wav", WavFile.encodeFloats(data[1])).generateAsync({type: "arraybuffer"})
    const decoded = await DawProject.decode(bytes)
    const {skeleton} = await DawProjectImport.read(decoded.project, decoded.resources)
    skeleton.boxGraph.beginTransaction()
    skeleton.boxGraph.boxes().filter(box => box instanceof AudioFileBox).forEach(box => box.fileName.setValue(name))
    skeleton.boxGraph.endTransaction()
    const samples = {getOrCreate: (uuid: UUID.Bytes) => ({data: Option.wrap(WavFile.decodeFloats(decoded.resources.fromUUID(uuid).buffer))})} as unknown as SampleLoaderManager
    const encoded = await DawProject.encode(skeleton, samples, decoded.metaData)
    const archive = await JSZip.loadAsync(encoded)
    const paths = Object.keys(archive.files).filter(path => path.endsWith(".wav"))
    expect(paths).toHaveLength(2)
    paths.forEach(path => expect(path).toMatch(/^samples\/[0-9a-f-]{36}\.wav$/))
    const roundtrip = await DawProject.decode(encoded)
    const imported = await DawProjectImport.read(roundtrip.project, roundtrip.resources)
    const regions = imported.skeleton.boxGraph.boxes().filter(box => box instanceof AudioRegionBox)
        .sort((left, right) => left.position.getValue() - right.position.getValue())
    expect(regions.map(region => WavFile.decodeFloats(roundtrip.resources.fromUUID(region.file.targetVertex.unwrap().address.uuid).buffer).frames[0][0])).toEqual([0.25, 0.5])
    expect(imported.skeleton.boxGraph.boxes().filter(box => box instanceof AudioFileBox).map(box => box.fileName.getValue())).toEqual([name, name])
})

it("serializes reordered MIDI and audio chains by index with stable UUID ties", async () => {
    const initial = await DawProject.decode(await new JSZip().file("project.xml", `<Project version="1.0"><Structure>
        <Track id="notes" contentType="notes"><Channel id="channel" role="regular" destination="master"/></Track>
        <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>
        </Structure></Project>`).generateAsync({type: "arraybuffer"}))
    const {skeleton} = await DawProjectImport.read(initial.project, initial.resources)
    const {boxGraph} = skeleton
    const unit = boxGraph.boxes().find(box => box instanceof AudioUnitBox && box.type.getValue() === AudioUnitType.Instrument) as AudioUnitBox
    boxGraph.beginTransaction()
    const audio = [0, 1, 2].map(index => DelayDeviceBox.create(boxGraph,
        UUID.parse(`00000000-0000-4000-8000-00000000000${index + 1}`), box => {
            box.host.refer(unit.audioEffects)
            box.label.setValue(`audio-${index}`)
            box.index.setValue(index)
        }))
    const midi = [0, 1].map(index => PitchDeviceBox.create(boxGraph, UUID.generate(), box => {
        box.host.refer(unit.midiEffects)
        box.label.setValue(`midi-${index}`)
        box.index.setValue(index)
    }))
    boxGraph.endTransaction()
    boxGraph.beginTransaction()
    audio[0].index.setValue(2)
    audio[1].index.setValue(0)
    audio[2].index.setValue(0)
    midi[0].index.setValue(1)
    midi[1].index.setValue(0)
    boxGraph.endTransaction()
    const samples = {getOrCreate: () => {throw new Error("No samples")}} as unknown as SampleLoaderManager
    const encoded = await DawProject.encode(skeleton, samples, Xml.element({}, MetaDataSchema))
    const decoded = await DawProject.decode(encoded)
    const {skeleton: imported} = await DawProjectImport.read(decoded.project, decoded.resources)
    const chain = (kind: typeof DelayDeviceBox | typeof PitchDeviceBox) => imported.boxGraph.boxes()
        .filter(box => box instanceof kind).sort((left, right) => DeviceBoxUtils.lookupIndexField(left).getValue() - DeviceBoxUtils.lookupIndexField(right).getValue())
        .map(box => DeviceBoxUtils.lookupLabelField(box).getValue())
    expect(chain(DelayDeviceBox)).toEqual(["audio-1", "audio-2", "audio-0"])
    expect(chain(PitchDeviceBox)).toEqual(["midi-1", "midi-0"])
})
