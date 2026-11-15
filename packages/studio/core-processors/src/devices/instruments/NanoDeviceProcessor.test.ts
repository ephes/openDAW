import {beforeAll, expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {DefaultObservableValue, Option, UUID} from "@opendaw/lib-std"
import {NanoDeviceBoxAdapter, SampleLoader} from "@opendaw/studio-adapters"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {processorFixture, block} from "../processor-test-fixture"
let Nano: typeof import("./NanoDeviceProcessor").NanoDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Nano = (await import("./NanoDeviceProcessor")).NanoDeviceProcessor})
function fixture() {
    const f = processorFixture(), enabled = f.field(true)
    const file = new DefaultObservableValue(Option.wrap({box: {address: f.address}}))
    const a = {data: Option.wrap({frames: [new Float32Array(4096).fill(1)], numberOfFrames: 4096, sampleRate})} as unknown as SampleLoader
    const b = {data: Option.wrap({frames: [new Float32Array(512).fill(-0.5)], numberOfFrames: 512, sampleRate})} as unknown as SampleLoader
    Object.assign(f.context, {sampleManager: {getOrCreate: (uuid: UUID.Bytes) => uuid === f.address.uuid ? a : b}})
    const p = new Nano(f.context, {address: f.address, uuid: f.address.uuid,
        audioUnitBoxAdapter: () => ({address: f.address}),
        namedParameter: {volume: f.field(0), release: f.field(0.01)},
        box: {enabled, file: {catchupAndSubscribe: (fn: (pointer: {targetVertex: Option<{box: {address: Address}}>}) => void) =>
            file.catchupAndSubscribe(owner => fn({targetVertex: owner.getValue()}))}}
    } as unknown as NanoDeviceBoxAdapter)
    const events: NoteLifecycleEvent[] = []
    p.setNoteEventSource({*processNotes() {yield* events.splice(0)}, *iterateActiveNotesAt() {}})
    return {p, enabled, file, events, a}
}
it("refuses disabled starts delivered through the note source across blocks", () => {
    const {p, enabled, events} = fixture()
    enabled.setValue(false)
    const held = NoteLifecycleEvent.start(0, 1000, 60, 1)
    events.push(held); p.process({blocks: [block()]})
    events.push(NoteLifecycleEvent.stop(held, 0), NoteLifecycleEvent.start(0, 1000, 60, 1))
    p.process({blocks: [block()]}); p.process({blocks: [block()]})
    enabled.setValue(true); p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).every(x => x === 0)).toBe(true)
    events.push(NoteLifecycleEvent.start(0, 1000, 60, 1)); p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0)[127]).toBeGreaterThan(0)
    p.terminate()
})
it("retires held voices when retargeting; only new notes read the new sample", () => {
    const {p, file, events} = fixture()
    const held = NoteLifecycleEvent.start(0, 1000, 60, 1)
    events.push(held); p.process({blocks: [block()]})
    file.setValue(Option.wrap({box: {address: Address.compose(UUID.generate())}}))
    p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).every(x => x === 0)).toBe(true)
    events.push(NoteLifecycleEvent.stop(held, 0), NoteLifecycleEvent.start(0, 1000, 60, 1))
    p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0)[127]).toBeLessThan(0)
    p.terminate()
})
