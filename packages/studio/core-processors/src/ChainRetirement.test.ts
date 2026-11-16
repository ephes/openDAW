import {expect, it, vi} from "vitest"
import {Option, UUID} from "@opendaw/lib-std"
import {ProcessPhase} from "./processing"
import {AudioUnit} from "./AudioUnit"
import {EngineContext} from "./EngineContext"
import {InsertReturnAudioChain, AudioTarget} from "./InsertReturnAudioChain"
import {MidiDeviceChain} from "./MidiDeviceChain"
import {AudioDeviceProcessor} from "./AudioDeviceProcessor"

vi.mock("./NoteSequencer", () => ({NoteSequencer: class {terminate() {}}}))
vi.mock("./DeviceProcessorFactory", () => ({
    MidiEffectDeviceProcessorFactory: {create: (_context: unknown, box: {device: unknown}) => box.device},
    AudioEffectDeviceProcessorFactory: {create: (_context: unknown, box: {device: unknown}) => box.device}
}))

it.each(["midi", "insert"])("retires every %s effect, enabled subscription and connection once", kind => {
    let edges = 0, connections = 0
    const lease = (release: () => void) => ({terminate: release})
    const effects = Array.from({length: 3}, () => {
        const listeners = new Set<() => void>()
        const enabledField = {getValue: () => true, subscribe: (callback: () => void) => {
            listeners.add(callback); return lease(() => listeners.delete(callback))
        }}
        const adapter = {uuid: UUID.generate(), enabledField, box: {device: undefined as unknown}}
        const connect = () => {connections++; return lease(() => connections--)}
        const device = {uuid: adapter.uuid, adapter: () => adapter, incoming: {}, outgoing: {},
            audioOutput: {}, setAudioSource: connect, setNoteEventSource: connect, reset: vi.fn(), terminate: vi.fn()}
        adapter.box.device = device
        return {adapter, device, listeners}
    })
    const collection = {adapters: () => effects.map(({adapter}) => adapter),
        catchupAndSubscribe: (observer: {onAdd: (adapter: unknown) => void}) => {
            effects.forEach(({adapter}) => observer.onAdd(adapter)); return lease(() => {})
        }}
    let phase: (phase: ProcessPhase) => void = () => {}
    const context = {subscribeProcessPhase: (callback: typeof phase) => {
        phase = callback; return lease(() => {phase = () => {}})
    }, registerEdge: () => {edges++; return lease(() => edges--)}} as unknown as EngineContext
    const target = {incoming: {}, setAudioSource: () => {connections++; return lease(() => connections--)},
        setNoteEventSource: () => {connections++; return lease(() => connections--)}}
    const chain = kind === "midi" ? new MidiDeviceChain({context,
        adapter: {midiEffects: collection}, frozen: Option.None,
        input: () => Option.wrap({noteEventTarget: Option.wrap(target)})} as unknown as AudioUnit)
        : InsertReturnAudioChain.create(context, collection as never,
            {audioOutput: {}, outgoing: {}} as AudioDeviceProcessor, target as unknown as AudioTarget)
    phase(ProcessPhase.Before)
    expect(edges).toBeGreaterThan(0)
    expect(connections).toBeGreaterThan(0)
    chain.terminate(); chain.terminate()
    expect(edges).toBe(0); expect(connections).toBe(0)
    effects.forEach(({device, listeners}) => {
        expect(device.terminate).toHaveBeenCalledOnce()
        expect(listeners.size).toBe(0)
        listeners.forEach(callback => callback())
        expect(device.reset).not.toHaveBeenCalled()
    })
    phase(ProcessPhase.Before)
    expect(edges).toBe(0); expect(connections).toBe(0)
})
