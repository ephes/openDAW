import {afterEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {BoxGraph} from "@opendaw/lib-box"
import {Xml} from "@opendaw/lib-xml"
import {ProjectSchema} from "@opendaw/lib-dawproject"
import {LoopableRegion, PPQN} from "@opendaw/lib-dsp"
import {AudioFileBox, AudioRegionBox, NoteEventBox, NoteRegionBox} from "@opendaw/studio-boxes"
import {DawProjectImport} from "./DawProjectImporter"
import {DawProject} from "./DawProject"

const resources: DawProject.ResourceProvider = {
    fromPath: vi.fn(() => {throw new Error("Unexpected resource read")}),
    fromUUID: vi.fn(() => {throw new Error("Unexpected resource read")})
}
const schema = (clips: string, rootAttributes = "", laneAttributes = "", clipsAttributes = "") => Xml.parse(`<Project version="1.0">
    <Structure>
        <Track id="notes" contentType="notes"><Channel id="channel" role="regular" destination="master"/></Track>
        <Track id="output" contentType="audio"><Channel id="master" role="master"/></Track>
    </Structure>
    <Arrangement><Lanes ${rootAttributes}><Lanes track="notes" ${laneAttributes}><Clips ${clipsAttributes}>${clips}</Clips></Lanes></Lanes></Arrangement>
</Project>`, ProjectSchema)
const notes = '<Notes><Note time="2" duration="0.5" channel="0" key="60"/><Note time="4" duration="0.5" channel="0" key="64"/><Note time="11" duration="0.5" channel="0" key="67"/></Notes>'
const read = (clips: string) => DawProjectImport.read(schema(clips), resources)

it.each([
    `<Clips><Clip>${notes}</Clip><Clip>${notes}</Clip></Clips>`,
    `<Clips><Clip>${notes}${notes}</Clip></Clips>`
])("refuses nested clip/content multiplicity before graph creation", async content => {
    await expect(read(`<Clip time="0" duration="8">${content}</Clip>`)).rejects.toThrow(/Unsupported nested Clips/)
})
it("keeps the supported single nested wrapper", async () => {
    const {skeleton} = await read(`<Clip time="0" duration="8"><Clips><Clip time="0" duration="8">${notes}</Clip></Clips></Clip>`)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof NoteRegionBox)).toHaveLength(1)
})
it("preserves a pre-loop lead-in and the declared eight-beat repeat span", async () => {
    const {skeleton} = await read(`<Clip time="10" duration="20" playStart="2" loopStart="4" loopEnd="12">${notes}</Clip>`)
    const regions = skeleton.boxGraph.boxes().filter(box => box instanceof NoteRegionBox).sort((a, b) => a.position.getValue() - b.position.getValue())
    expect(regions.map(box => [box.position.getValue(), box.duration.getValue(), box.loopDuration.getValue()])
        .map(values => values.map(value => value / PPQN.Quarter))).toEqual([[10, 2, 2], [12, 18, 8]])
    const played: number[] = []
    for (const box of regions) {
        const position = box.position.getValue(), complete = position + box.duration.getValue()
        const collection = box.events.targetVertex.unwrap().box
        const events = collection.graph.boxes().filter((event): event is NoteEventBox => event instanceof NoteEventBox && event.events.targetVertex.unwrap().box === collection)
        for (const loop of LoopableRegion.locateLoops({position, complete, loopOffset: box.loopOffset.getValue(), loopDuration: box.loopDuration.getValue()}, position, complete)) {
            for (const event of events) {
                const at = loop.rawStart + event.position.getValue()
                if (at >= loop.resultStart && at < loop.resultEnd) {played.push(at / PPQN.Quarter)}
            }
        }
    }
    expect(played.sort((a, b) => a - b)).toEqual([10, 12, 19, 20, 27, 28])
})
it.each(['loopStart="4" loopEnd="4"', 'loopStart="4" loopEnd="3"'])("refuses invalid loops %s", async loop => {
    await expect(read(`<Clip time="0" duration="8" ${loop}>${notes}</Clip>`)).rejects.toThrow(/nonpositive note loop/)
})
it("retains a nonlooping clip and its trimmed source offset without repetitions", async () => {
    const {skeleton} = await read(`<Clip time="0" duration="8" playStart="2">${notes}</Clip>`)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
    expect(region.loopDuration.getValue()).toBe(8 * PPQN.Quarter)
    const events = skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox)
    expect(events.map(box => box.position.getValue() / PPQN.Quarter).sort((a, b) => a - b)).toEqual([0, 2])
})
it("offsets playback within the declared loop window", async () => {
    const {skeleton} = await read(`<Clip time="0" duration="20" playStart="6" loopStart="4" loopEnd="12">${notes}</Clip>`)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
    expect(region.loopOffset.getValue()).toBe(2 * PPQN.Quarter)
    expect(region.loopDuration.getValue()).toBe(8 * PPQN.Quarter)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox)
        .map(box => box.position.getValue() / PPQN.Quarter).sort((a, b) => a - b)).toEqual([0, 7])
})
it("does not invent note-ons at trimmed or repeating window starts", async () => {
    const crossing = '<Notes><Note time="1" duration="4" key="59" channel="0"/><Note time="3" duration="2" key="62" channel="0"/><Note time="4" duration="1" key="64" channel="0"/></Notes>'
    const {skeleton} = await read(`<Clip time="0" duration="20" playStart="2" loopStart="4" loopEnd="12">${crossing}</Clip>`)
    const events = skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox)
    expect(events.map(box => box.pitch.getValue()).sort((a, b) => a - b)).toEqual([62, 64])
    const held = events.find(box => box.pitch.getValue() === 62) as NoteEventBox
    expect(held.position.getValue()).toBe(PPQN.Quarter)
    expect(held.duration.getValue()).toBe(PPQN.Quarter)
    const loop = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox && box.loopDuration.getValue() === 8 * PPQN.Quarter) as NoteRegionBox
    expect(held.events.targetVertex.unwrap().box).not.toBe(loop.events.targetVertex.unwrap().box)
    const trimmed = await read(`<Clip time="0" duration="8" playStart="2">${crossing}</Clip>`)
    expect(trimmed.skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox).some(box => box.pitch.getValue() === 59)).toBe(false)
})
it.each([0.25 / PPQN.Quarter, 1 - 0.25 / PPQN.Quarter])("omits sub-pulse split pieces near loopStart %s", async loopStart => {
    const tiny = `<Notes><Note time="0" duration="${0.25 / PPQN.Quarter}" key="60" channel="0"/></Notes>`
    const {skeleton} = await read(`<Clip time="0" duration="1" loopStart="${loopStart}" loopEnd="2">${tiny}</Clip>`)
    const regions = skeleton.boxGraph.boxes().filter(box => box instanceof NoteRegionBox)
    expect(regions).toHaveLength(1)
    expect(regions.every(box => box.duration.getValue() >= 1 && box.loopDuration.getValue() >= 1)).toBe(true)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox)).toHaveLength(0)
})
it("refuses clips whose split pieces would all vanish at pulse resolution", async () => {
    await expect(read(`<Clip time="0" duration="${1.5 / PPQN.Quarter}" loopStart="${0.75 / PPQN.Quarter}" loopEnd="2">${notes}</Clip>`))
        .rejects.toThrow(/sub-pulse note clip/)
})

afterEach(() => vi.restoreAllMocks())
it.each(["", 'timeUnit="beats"'])("imports exact beat timing with inherited %s", async attributes => {
    const project = schema(`<Clip time="2" duration="8">${notes}</Clip>`, attributes)
    const {skeleton} = await DawProjectImport.read(project, resources)
    const region = skeleton.boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
    expect(region.position.getValue()).toBe(2 * PPQN.Quarter)
    expect(region.duration.getValue()).toBe(8 * PPQN.Quarter)
    expect(skeleton.boxGraph.boxes().filter(box => box instanceof NoteEventBox).map(box => box.position.getValue()).sort((a, b) => a - b))
        .toEqual([2, 4].map(value => value * PPQN.Quarter))
})
it.each([
    ['timeUnit="seconds"', "", "", "", notes],
    ["", 'timeUnit="seconds"', "", "", notes],
    ["", "", 'timeUnit="seconds"', "", notes],
    ["", "", "", 'contentTimeUnit="seconds"', notes],
    ["", "", "", "", notes.replace("<Notes>", '<Notes timeUnit="seconds">')],
    ['timeUnit="seconds"', 'timeUnit="beats"', "", "", notes]
])("refuses inherited or mixed units before graph mutation", async (root, lane, clips, clip, content) => {
    const project = schema(`<Clip time="2" duration="8" ${clip}>${content}</Clip>`, root, lane, clips)
    const begin = vi.spyOn(BoxGraph.prototype, "beginTransaction")
    await expect(DawProjectImport.read(project, resources)).rejects.toThrow(/Unsupported timeline time unit/)
    expect(begin).not.toHaveBeenCalled()
})
it("refuses seconds-based tempo automation before graph mutation", async () => {
    const xml = Xml.pretty(Xml.toElement("Project", schema(`<Clip time="0" duration="8">${notes}</Clip>`)))
        .replace("<Arrangement>", '<Arrangement><TempoAutomation timeUnit="seconds"><RealPoint time="1" value="120"/></TempoAutomation>')
    const project = Xml.parse(xml, ProjectSchema)
    const begin = vi.spyOn(BoxGraph.prototype, "beginTransaction")
    await expect(DawProjectImport.read(project, resources)).rejects.toThrow(/Unsupported timeline time unit/)
    expect(begin).not.toHaveBeenCalled()
})

const audioProject = (warpAttributes: string, audioAttributes: string) => schema(`<Clip time="2" duration="4"><Warps ${warpAttributes}>
    <Warp time="0" contentTime="0"/><Warp time="8" contentTime="4"/>
    <Audio duration="4" channels="1" sampleRate="4" ${audioAttributes}><File path="synthetic.wav"/></Audio>
</Warps></Clip>`)
it.each([["", ""], ['timeUnit="beats" contentTimeUnit="seconds"', 'timeUnit="seconds"']])("distinguishes beat warp timing from second source timing", async (warpAttributes, audioAttributes) => {
    const resource = {uuid: UUID.generate(), path: "synthetic.wav", name: "synthetic.wav", buffer: new ArrayBuffer(0)}
    const {skeleton} = await DawProjectImport.read(audioProject(warpAttributes, audioAttributes), {fromPath: () => resource, fromUUID: () => resource})
    const region = skeleton.boxGraph.boxes().find(box => box instanceof AudioRegionBox) as AudioRegionBox
    expect(region.position.getValue()).toBe(2 * PPQN.Quarter)
    expect(region.duration.getValue()).toBe(4 * PPQN.Quarter)
    expect(region.loopDuration.getValue()).toBe(8 * PPQN.Quarter)
    expect((region.file.targetVertex.unwrap().box as AudioFileBox).endInSeconds.getValue()).toBe(4)
})
it.each([
    ['timeUnit="seconds" contentTimeUnit="seconds"', ""],
    ['contentTimeUnit="beats"', ""],
    ['contentTimeUnit="seconds"', 'timeUnit="beats"']
])("refuses unsupported warp/media units before graph mutation", async (warpAttributes, audioAttributes) => {
    const begin = vi.spyOn(BoxGraph.prototype, "beginTransaction")
    await expect(DawProjectImport.read(audioProject(warpAttributes, audioAttributes), resources)).rejects.toThrow(/Unsupported .*time unit/)
    expect(begin).not.toHaveBeenCalled()
})
