import {assert, UUID} from "@opendaw/lib-std"
import {Xml} from "@opendaw/lib-xml"
import {PPQN, ValueEvent} from "@opendaw/lib-dsp"
import {FileReferenceSchema, ProjectSchema} from "@opendaw/lib-dawproject"
import {AuxSendBox, MarkerBox, NoteEventBox, NoteRegionBox, TrackBox, ValueEventBox} from "@opendaw/studio-boxes"
import {InterpolationFieldAdapter, ProjectSkeleton, SampleLoaderManager, TempoGridCursor, TrackType} from "@opendaw/studio-adapters"
import {DawProjectImport, DawProjectExporter} from "@opendaw/studio-core"

// Entirely synthetic interchange graph; no audio assets, account or storage writes.
export const interchange = async (): Promise<void> => {
    const q = PPQN.Quarter
    const packed = new Map<string, ArrayBufferLike>()
    let reads = 0
    const resources = {
        fromPath: (path: string) => {reads++; return {uuid: UUID.generate(), path, name: path, buffer: packed.get(path)! as ArrayBuffer}},
        fromUUID: () => {throw new Error("No audio resources in this fixture")}
    }
    const text = `<Project version="1.0"><Structure>
        <Track id="parent" contentType="notes"><Channel id="parent-channel" role="regular" destination="master"/>
            <Track id="child" contentType="notes"><Channel id="child-channel" role="regular" destination="master"/></Track>
        </Track>
        <Track id="output" contentType="audio"><Channel id="master" role="master"><Sends><Send destination="aux-channel" type="pre"><Volume value="0.5"/><Pan value="0.25"/></Send></Sends></Channel></Track>
        <Track id="aux"><Channel id="aux-channel" role="effect"/></Track>
        </Structure><Arrangement>
        <TempoAutomation unit="bpm"><RealPoint time="0" value="120" interpolation="hold"/><RealPoint time="4" value="400"/></TempoAutomation>
        <Markers timeUnit="beats"><Marker time="2" name="Verse" color="#33ff33"/></Markers>
        <Lanes track="child"><Lanes><Lanes><Clips><Clip time="2" duration="4"><Clips><Clip time="0" duration="4"><Notes><Note time="0" duration="1" key="60" channel="0"/></Notes></Clip></Clips></Clip></Clips></Lanes></Lanes></Lanes>
        </Arrangement></Project>`
    const read = (text: string) => DawProjectImport.read(Xml.parse(text, ProjectSchema), resources)
    const {skeleton} = await read(text)
    const boxes = skeleton.boxGraph.boxes()
    const events: ValueEvent[] = boxes.filter(box => box instanceof ValueEventBox)
        .sort((a, b) => a.position.getValue() - b.position.getValue())
        .map(box => ({type: 'value-event', position: box.position.getValue(), index: 0,
            value: box.value.getValue(), interpolation: InterpolationFieldAdapter.read(box.interpolation)}))
    assert(events[0].value === 120 && events[1].value === 400, "BPM changed during import")
    const cursor = new TempoGridCursor()
    assert(Math.abs(cursor.integrate(events, 0, 4 * q, 90) - 2) < 1e-9, "120 BPM playback timing changed")
    assert(Math.abs(cursor.integrate(events, 4 * q, 8 * q, 90) - 0.6) < 1e-9, "400 BPM playback timing changed")
    const region = boxes.find(box => box instanceof NoteRegionBox) as NoteRegionBox
    const note = boxes.find(box => box instanceof NoteEventBox) as NoteEventBox
    assert(region.position.getValue() + note.position.getValue() === 2 * q, "Nested child note placement changed")
    assert(boxes.some(box => box instanceof TrackBox && box.type.getValue() === TrackType.Notes), "Notes track kind lost")
    const send = boxes.find(box => box instanceof AuxSendBox) as AuxSendBox
    assert(send.sendPan.getValue() === -0.5 && send.routing.getValue() === 0, "Primary send state lost")
    const reopened = ProjectSkeleton.decode(ProjectSkeleton.encode(skeleton.boxGraph))
    assert(reopened.boxGraph.boxes().some(box => box instanceof MarkerBox && box.label.getValue() === 'Verse' && box.position.getValue() === 2 * q), "Marker lost during native save/reopen")
    const exported = DawProjectExporter.write(skeleton, {} as SampleLoaderManager, {write: (path, buffer) => {
        packed.set(path, buffer)
        return Xml.element({path}, FileReferenceSchema)
    }})
    const element = Xml.toElement('Project', exported)
    assert(element.querySelector('TempoAutomation > RealPoint')?.getAttribute('value') === '120', "BPM changed during export")
    assert(element.querySelector('Markers > Marker')?.getAttribute('time') === '2', "Marker export coordinate changed")
    const reimported = await read(Xml.pretty(element))
    reimported.skeleton.boxGraph.verifyPointers()
    for (const invalid of [
        text.replace('destination="master"', 'destination="missing"'),
        text.replace('<Clip time="2" duration="4">', '<Clip time="2" duration="4" reference="shared">'),
        text.replace('<Clip time="0" duration="4">', '<Clip time="1" duration="4">'),
        text.replace('RealPoint time="0"', 'RealPoint time="garbage"'),
        text.replace('Markers timeUnit="beats"', 'Markers timeUnit="seconds"')
    ]) {
        const before = reads
        let refused = false
        try {await read(invalid)} catch {refused = true}
        assert(refused && reads === before, "Invalid interchange input reached resource reads")
    }
}
