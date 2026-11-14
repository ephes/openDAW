import {afterEach, expect, it, vi} from "vitest"
import {EventCollection, NoteEvent, PPQN} from "@opendaw/lib-dsp"
import {Files} from "@opendaw/lib-dom"
import {RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {BoxEditing} from "@opendaw/lib-box"
import {AudioUnitBox, NoteEventBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {Wait} from "@opendaw/lib-runtime"
import {MidiImport} from "./MidiImport"
import {Dialogs} from "@/ui/components/dialogs.tsx"

vi.mock("@/ui/components/dialogs.tsx", () => ({Dialogs: {info: vi.fn(async () => {})}}))
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})

const exported = async () => {
    // The package entry point declares the browser worklet class; this smoke never creates one.
    vi.stubGlobal("AudioWorkletNode", class {})
    const {NoteMidiExport} = await import("@opendaw/studio-core")
    const collection = EventCollection.create<NoteEvent>(NoteEvent.Comparator)
    collection.add({type: "note-event", position: PPQN.Quarter, duration: PPQN.Quarter,
        pitch: 60, cent: 0, velocity: 1})
    collection.add({type: "note-event", position: 0, duration: PPQN.Quarter / 2,
        pitch: 64, cent: 0, velocity: 1})
    let bytes: ArrayBuffer | undefined
    vi.spyOn(Files, "save").mockImplementation(async buffer => {bytes = buffer; return "synthetic.mid"})
    const result = await NoteMidiExport.toFile({events: collection} as Parameters<typeof NoteMidiExport.toFile>[0])
    expect(result.status).toBe("resolved")
    return bytes!
}
const setup = (buffer: ArrayBuffer) => {
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const audioUnit = editing.modify(() => AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Instrument)
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
    })).unwrap()
    const project = {boxGraph, editing} as unknown as Parameters<typeof MidiImport.toTracks>[0]
    const adapter = {box: audioUnit, tracks: {collection: {adapters: () => []}}} as unknown as Parameters<typeof MidiImport.toTracks>[1]
    vi.spyOn(Files, "open").mockResolvedValue([{name: "synthetic.mid", arrayBuffer: async () => buffer} as File])
    vi.spyOn(Wait, "frame").mockResolvedValue()
    const terminate = vi.fn()
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate, message: ""})
    return {project, adapter, boxGraph, editing, terminate}
}

it("smokes actual studio MIDI file export and import with a real graph", async () => {
    const {project, adapter, boxGraph, terminate} = setup(await exported())
    await MidiImport.toTracks(project, adapter)
    const notes = boxGraph.boxes().filter(box => box instanceof NoteEventBox)
        .map(box => [box.position.getValue(), box.duration.getValue(), box.pitch.getValue()])
        .sort((a, b) => a[0] - b[0])
    expect(notes).toEqual([[0, PPQN.Quarter / 2, 64], [PPQN.Quarter, PPQN.Quarter, 60]])
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(Dialogs.info).not.toHaveBeenCalled()
})

it("refuses malformed MIDI before starting any studio graph modification", async () => {
    const bytes = await exported()
    new Uint8Array(bytes)[24] = 0xff // First channel parameter has its status bit set.
    const {project, adapter, editing, boxGraph, terminate} = setup(bytes)
    const modify = vi.spyOn(editing, "beginModification")
    await MidiImport.toTracks(project, adapter)
    expect(modify).not.toHaveBeenCalled()
    expect(boxGraph.boxes().filter(box => box instanceof NoteEventBox)).toHaveLength(0)
    expect(Dialogs.info).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
})
