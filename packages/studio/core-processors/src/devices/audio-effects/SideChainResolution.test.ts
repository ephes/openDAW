import {beforeAll, expect, it, vi} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Option, UUID} from "@opendaw/lib-std"
import {CompressorDeviceBoxAdapter, VocoderDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {AudioOutputBufferRegistry} from "../../AudioOutputBufferRegistry"
import {Processor, ProcessPhase} from "../../processing"
import {AudioEffectDeviceProcessor} from "../../AudioEffectDeviceProcessor"
let Compressor: typeof import("./CompressorDeviceProcessor").CompressorDeviceProcessor
let Vocoder: typeof import("./VocoderDeviceProcessor").VocoderDeviceProcessor
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    Compressor = (await import("./CompressorDeviceProcessor")).CompressorDeviceProcessor
    Vocoder = (await import("./VocoderDeviceProcessor")).VocoderDeviceProcessor
})
const terminable = () => ({terminate() {}})
const field = (value: unknown) => ({getValue: () => value, catchupAndSubscribe: (fn: (owner: {getValue: () => unknown}) => void) => {fn({getValue: () => value}); return terminable()}})
const compressorParams = {lookahead: false, automakeup: false, autoattack: false, autorelease: false,
    inputgain: 0, threshold: -10, ratio: 4, knee: 6, attack: 2, release: 140, makeup: 0, mix: 1}
const vocoderParams = {carrierMinFreq: 80, carrierMaxFreq: 8000, modulatorMinFreq: 80, modulatorMaxFreq: 8000,
    qMin: 2, qMax: 8, envAttack: 5, envRelease: 50, gain: 0, mix: 1}
type Create = (context: EngineContext, adapter: unknown) => AudioEffectDeviceProcessor & {terminate(): void}
const devices: ReadonlyArray<[string, Record<string, unknown>, Create]> = [
    ["Compressor", compressorParams, (context, adapter) => new Compressor(context, adapter as CompressorDeviceBoxAdapter)],
    ["Vocoder", vocoderParams, (context, adapter) => new Vocoder(context, adapter as VocoderDeviceBoxAdapter)]
]
it.each(devices)("%s retries an unresolved sidechain until its target registers", (_name, params, create) => {
    const address = Address.compose(UUID.generate()), target = Address.compose(UUID.generate())
    const namedParameter = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, {
        address, getValue: () => value, subscribe: terminable, valueMapping: {x: (x: number) => x},
        field: {pointerHub: {catchupAndSubscribe: terminable}}
    }]))
    let changed = () => {}
    const sideChain = {targetVertex: Option.wrap({box: {address: target}}),
        catchupAndSubscribe: (fn: () => void) => {changed = fn; fn(); return terminable()}}
    const phases = new Set<(phase: ProcessPhase) => void>()
    const registry = new AudioOutputBufferRegistry(), edges = new Set<Processor>()
    const registerEdge = vi.fn((source: Processor) => {
        edges.add(source)
        return {terminate: () => {edges.delete(source)}}
    })
    const context = {broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: registry, registerEdge,
        subscribeProcessPhase: (fn: (phase: ProcessPhase) => void) => {
            phases.add(fn); return {terminate: () => {phases.delete(fn)}}
        }} as unknown as EngineContext
    const adapter = {address, uuid: address.uuid, namedParameter, sideChain,
        modulatorSpectrum: address.append(1), carrierSpectrum: address.append(2),
        box: {modulatorSource: field("external"), bandCount: field(16)}}
    const processor = create(context, adapter)
    const before = () => phases.forEach(fn => fn(ProcessPhase.Before))
    before(); before()
    expect(registerEdge).not.toHaveBeenCalled()
    const source = {} as Processor
    registry.register(target, new AudioBuffer(), source)
    before(); before()
    expect(registerEdge).toHaveBeenCalledTimes(1)
    expect(edges.has(source)).toBe(true)
    sideChain.targetVertex = Option.None; changed(); before()
    expect(edges.size).toBe(0)
    expect(registerEdge).toHaveBeenCalledTimes(1)
    processor.terminate()
    expect(phases.size).toBe(0)
})
