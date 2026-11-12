import {expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {Procedure, Terminable, UUID} from "@opendaw/lib-std"
import {LiveStreamBroadcaster} from "@opendaw/lib-fusion"
import {NoteEvent} from "@opendaw/lib-dsp"
import {PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox} from "@opendaw/studio-boxes"
import {
    NoteBroadcaster, PitchDeviceBoxAdapter, VelocityDeviceBoxAdapter, ZeitgeistDeviceBoxAdapter
} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {NoteEventSource, NoteLifecycleEvent} from "../../NoteEventSource"
import {PitchDeviceProcessor} from "./PitchDeviceProcessor"
import {VelocityDeviceProcessor} from "./VelocityDeviceProcessor"
import {ZeitgeistDeviceProcessor} from "./ZeitgeistDeviceProcessor"
import {noteChainFixture} from "./note-chain-fixture"

type Fixture = ReturnType<typeof noteChainFixture>
type Stream = {values: Int32Array, update: Procedure<boolean>}

const capture = () => {
    const streams: Array<Stream> = []
    const broadcaster = {
        broadcastIntegers: (_address: Address, values: Int32Array, update: Procedure<boolean>) => {
            streams.push({values, update})
            return Terminable.Empty
        }
    } as unknown as LiveStreamBroadcaster
    return {streams, broadcaster}
}

const lit = (values: Int32Array, pitch: number) => (values[pitch >>> 5] & (1 << (pitch & 31))) !== 0

const start = (pitch: number, position = 0): NoteLifecycleEvent =>
    NoteLifecycleEvent.start(position, 100, pitch, 0.5)

const queued = (events: Array<NoteLifecycleEvent>): NoteEventSource => ({
    * processNotes() {yield* events.splice(0)},
    * iterateActiveNotesAt(): IterableIterator<NoteEvent> {}
})

it("keeps an overlapped pitch displayed until its last owner stops", () => {
    const {streams, broadcaster} = capture()
    const display = new NoteBroadcaster(broadcaster, Address.compose(UUID.generate()))
    const {values} = streams[0]
    display.noteOn(60)
    display.noteOn(60)
    display.noteOff(60)
    expect(lit(values, 60)).toBe(true)
    display.noteOff(60)
    expect(lit(values, 60)).toBe(false)
    display.noteOff(60)
    display.noteOn(60)
    expect(lit(values, 60)).toBe(true)
})

const effects = {
    pitch: (f: Fixture, context: EngineContext) => new PitchDeviceProcessor(context, f.adapters.adapterFor(
        PitchDeviceBox.create(f.graph, UUID.generate()), PitchDeviceBoxAdapter)),
    velocity: (f: Fixture, context: EngineContext) => new VelocityDeviceProcessor(context, f.adapters.adapterFor(
        VelocityDeviceBox.create(f.graph, UUID.generate()), VelocityDeviceBoxAdapter)),
    zeitgeist: (f: Fixture, context: EngineContext) => new ZeitgeistDeviceProcessor(context, f.adapters.adapterFor(
        ZeitgeistDeviceBox.create(f.graph, UUID.generate(), box => box.groove.refer(f.groove)), ZeitgeistDeviceBoxAdapter))
}

it.each(["pitch", "velocity", "zeitgeist"] as const)("clears the %s device note display on reset", kind => {
    const f = noteChainFixture(), {streams, broadcaster} = capture()
    f.graph.beginTransaction()
    const processor = effects[kind](f, {...f.context, broadcaster} as EngineContext)
    f.graph.endTransaction()
    const events = [start(60)]
    processor.setNoteEventSource(queued(events))
    Array.from(processor.processNotes(0, 100, 0))
    expect(lit(streams[0].values, 60)).toBe(true)
    processor.reset()
    expect(lit(streams[0].values, 60)).toBe(false)
})

it("keeps the velocity display cursor inside its buffer", () => {
    const f = noteChainFixture(), {streams, broadcaster} = capture()
    f.graph.beginTransaction()
    const box = VelocityDeviceBox.create(f.graph, UUID.generate())
    f.graph.endTransaction()
    const processor = new VelocityDeviceProcessor({...f.context, broadcaster} as EngineContext,
        f.adapters.adapterFor(box, VelocityDeviceBoxAdapter))
    const {values, update} = streams[1]
    const events = Array.from({length: values.length + 10}, (_, index) => start(60, index))
    processor.setNoteEventSource(queued(events))
    Array.from(processor.processNotes(0, values.length + 10, 0))
    update(true)
    expect(values.indexOf(0)).toBe(values.length - 1)
    events.push(start(62))
    Array.from(processor.processNotes(0, 1, 0))
    update(true)
    expect(values.indexOf(0)).toBe(1)
})
