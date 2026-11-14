import {beforeAll, expect, it, vi} from "vitest"
import {Address} from "@opendaw/lib-box"
import {DefaultObservableValue, Option, Terminable, UUID} from "@opendaw/lib-std"
import {SoundfontDeviceBoxAdapter, SoundfontLoader} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {Block} from "../../processing"

const voice = vi.hoisted(() => ({release: vi.fn(), processAdd: vi.fn(() => false)}))
vi.mock("./Soundfont/SoundfontVoice", () => ({SoundfontVoice: class {
    constructor(readonly event: NoteLifecycleEvent) {}
    release = voice.release
    processAdd = voice.processAdd
}}))
let SoundfontDeviceProcessor: typeof import("./SoundfontDeviceProcessor").SoundfontDeviceProcessor
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    SoundfontDeviceProcessor = (await import("./SoundfontDeviceProcessor")).SoundfontDeviceProcessor
})
const block: Block = {index: 0, p0: 0, p1: 1, s0: 0, s1: 128, bpm: 120, flags: 0}
const fixture = () => {
    voice.release.mockClear(); voice.processAdd.mockClear()
    const address = Address.compose(UUID.generate())
    const oldFont = {presets: [{zones: [{generators: {}, instrument: {zones: [{generators: {}}]}}]}]}
    const loader = {soundfont: Option.wrap(oldFont)} as unknown as SoundfontLoader
    const pending = {soundfont: Option.None} as unknown as SoundfontLoader
    const file = new DefaultObservableValue(Option.wrap({box: {address}}))
    const streams: Int32Array[] = []
    const context = {registerProcessor: () => Terminable.Empty,
        audioOutputBufferRegistry: {register: () => Terminable.Empty},
        soundfontManager: {getOrCreate: vi.fn().mockReturnValueOnce(loader).mockReturnValue(pending)},
        broadcaster: {broadcastIntegers: (_address: Address, values: Int32Array) => {
            streams.push(values); return Terminable.Empty
        }, broadcastFloats: () => Terminable.Empty}} as unknown as EngineContext
    const adapter = {address, uuid: address.uuid, presetIndex: 0,
        audioUnitBoxAdapter: () => ({address}),
        box: {enabled: new DefaultObservableValue(true), file: {
            catchupAndSubscribe: (observer: (pointer: {targetVertex: Option<{box: {address: Address}}>}) => void) =>
                file.catchupAndSubscribe(owner => observer({targetVertex: owner.getValue()}))
        }}} as unknown as SoundfontDeviceBoxAdapter
    const processor = new SoundfontDeviceProcessor(context, adapter)
    const event = NoteLifecycleEvent.start(0, 100, 60, 0.8)
    const events = [event]
    processor.setNoteEventSource({*processNotes() {yield* events.splice(0)}, *iterateActiveNotesAt() {}})
    processor.introduceBlock(block)
    processor.handleEvent(processor.eventInput.get(0)[0])
    processor.processAudio(block)
    expect(voice.processAdd).toHaveBeenCalledOnce()
    expect(streams[0][1] & (1 << 28)).not.toBe(0)
    return {processor, file, streams, loader, event}
}

it.each(["pending", "empty"])("retires old voices and note display when retargeted to %s", kind => {
    const {processor, file, streams, event} = fixture()
    voice.processAdd.mockClear()
    file.setValue(kind === "empty" ? Option.None : Option.wrap({box: {address: Address.compose(UUID.generate())}}))
    processor.handleEvent(NoteLifecycleEvent.stop(event, 0))
    processor.processAudio(block)
    expect(voice.processAdd).not.toHaveBeenCalled()
    expect(Array.from(streams[0])).toEqual([0, 0, 0, 0])
    expect(processor.audioOutput.getChannel(0).every(value => value === 0)).toBe(true)
    processor.terminate()
})

it("processes note stops while the current font becomes unavailable", () => {
    const {processor, loader} = fixture()
    // The loader can lose its current font without changing the file pointer.
    Object.assign(loader, {soundfont: Option.None})
    const event = processor.eventInput.get(0)[0]
    if (!NoteLifecycleEvent.isStart(event)) {throw new Error("Expected start")}
    processor.handleEvent(NoteLifecycleEvent.stop(event, 0))
    expect(voice.release).toHaveBeenCalledOnce()
    processor.terminate()
})
