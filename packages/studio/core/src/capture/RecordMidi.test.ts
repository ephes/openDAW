import {afterEach, describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, Notifier, Optional, UUID} from "@opendaw/lib-std"
import {BoxEditing} from "@opendaw/lib-box"
import {PPQN} from "@opendaw/lib-dsp"
import {AudioUnitBox, NoteEventBox} from "@opendaw/studio-boxes"
import {NoteSignal, ProjectSkeleton} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {AudioUtils} from "../AudioUtils"
import {RecordMidi} from "./RecordMidi"

afterEach(() => vi.restoreAllMocks())

const setup = (outputLatency: Optional<number>) => {
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioBusBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const audioUnitBox = editing.modify(() => AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Instrument)
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
    })).unwrap()
    const position = new DefaultObservableValue(0)
    const recording = {allowTakes: false, olderTakeAction: "mute-region", olderTakeScope: "none"}
    const engine = {
        position, isRecording: new DefaultObservableValue(true), preferences: {settings: {recording}},
        ignoreNoteRegion: vi.fn()
    }
    const loopArea = {enabled: new DefaultObservableValue(false), from: new DefaultObservableValue(0), to: new DefaultObservableValue(0)}
    const timelineBox = {signature: {denominator: new DefaultObservableValue(4)}, bpm: new DefaultObservableValue(120), loopArea}
    const project = {editing, boxGraph, engine, env: {audioContext: {outputLatency}}, timelineBox, selection: {select: vi.fn()}}
    const capture = {audioUnitBox, addRecordedRegion: vi.fn()}
    const notifier = new Notifier<NoteSignal>()
    type Context = Parameters<typeof RecordMidi.start>[0]
    const recorder = RecordMidi.start({notifier, project, capture} as unknown as Context)
    const uuid = audioUnitBox.address.uuid
    const notes = () => boxGraph.boxes().filter(box => box instanceof NoteEventBox)
        .map(box => ({position: box.position.getValue(), duration: box.duration.getValue()}))
        .sort((left, right) => left.position - right.position)
    return {
        recorder, position, notes,
        on: (pitch: number) => notifier.notify(NoteSignal.on(uuid, pitch, 1.0)),
        off: (pitch: number) => notifier.notify(NoteSignal.off(uuid, pitch))
    }
}

describe("output latency defaults", () => {
    it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -0.5])(
        "treats %s as unknown latency without shifting notes", latency => {
            const {recorder, position, on, notes} = setup(latency)
            position.setValue(960)
            on(60)
            expect(notes().map(note => note.position)).toEqual([960])
            recorder.terminate()
        })

    it("still compensates a reported latency", () => {
        const {recorder, position, on, notes} = setup(0.05)
        position.setValue(960)
        on(60)
        expect(notes().map(note => note.position)).toEqual([960 + PPQN.secondsToPulses(0.05, 120)])
        recorder.terminate()
    })

    it("keeps valid latency values", () => {
        expect(AudioUtils.outputLatencySeconds(0.0)).toBe(0.0)
        expect(AudioUtils.outputLatencySeconds(0.02)).toBe(0.02)
        expect(AudioUtils.outputLatencySeconds(undefined)).toBe(0.0)
    })
})

describe("retriggered recording", () => {
    it("keeps recording the retriggered note until its last release", () => {
        const {recorder, position, on, off, notes} = setup(0)
        on(60)
        position.setValue(240)
        position.setValue(480)
        on(60)
        off(60)
        position.setValue(960)
        position.setValue(1440)
        off(60)
        position.setValue(1920)
        expect(notes()).toEqual([{position: 0, duration: 480}, {position: 480, duration: 960}])
        recorder.terminate()
    })

    it("still ends a single press at its release", () => {
        const {recorder, position, on, off, notes} = setup(0)
        on(60)
        position.setValue(480)
        off(60)
        position.setValue(960)
        expect(notes()).toEqual([{position: 0, duration: 480}])
        recorder.terminate()
    })
})
