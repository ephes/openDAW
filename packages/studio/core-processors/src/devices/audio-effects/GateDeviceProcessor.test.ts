import {beforeAll, expect, it, vi} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Option, UUID} from "@opendaw/lib-std"
import {GateDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {AudioOutputBufferRegistry} from "../../AudioOutputBufferRegistry"
import {Block, Processor, ProcessPhase} from "../../processing"
let Gate: typeof import("./GateDeviceProcessor").GateDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Gate = (await import("./GateDeviceProcessor")).GateDeviceProcessor})
const terminable = () => ({terminate() {}})
it("resolves a late sidechain once, retires retargeted edges and unsubscribes", () => {
    const address = Address.compose(UUID.generate()), target = Address.compose(UUID.generate()), later = Address.compose(UUID.generate())
    const namedParameter = Object.fromEntries(Object.entries({inverse: false, threshold: -10, return: 3, attack: 0, hold: 0, release: 1, floor: -80}).map(([name, value]) => [name, {
        address, getValue: () => value, subscribe: terminable, valueMapping: {x: (x: number) => x},
        field: {pointerHub: {catchupAndSubscribe: terminable}}
    }]))
    let changed = () => {}
    const sideChain = {targetVertex: Option.wrap({box: {address: target}}),
        catchupAndSubscribe: (fn: () => void) => {changed = fn; fn(); return terminable()}}
    const phases = new Set<(phase: ProcessPhase) => void>()
    const registry = new AudioOutputBufferRegistry(), edges = new Set<Processor>()
    const registerEdge = vi.fn((source: Processor) => {
        expect(edges.has(source)).toBe(false); edges.add(source)
        return {terminate: () => {edges.delete(source)}}
    })
    const context = {broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: registry, registerEdge,
        subscribeProcessPhase: (fn: (phase: ProcessPhase) => void) => {
            phases.add(fn); return {terminate: () => {phases.delete(fn)}}
        }} as unknown as EngineContext
    const p = new Gate(context, {address, uuid: address.uuid, namedParameter, sideChain} as unknown as GateDeviceBoxAdapter)
    const before = () => phases.forEach(fn => fn(ProcessPhase.Before))
    const block: Block = {index: 0, p0: 0, p1: 1, s0: 0, s1: 128, bpm: 120, flags: 0}
    const input = new AudioBuffer(), detector = new AudioBuffer()
    input.channels().forEach(ch => ch.fill(0.01)); detector.channels().forEach(ch => ch.fill(1))
    p.setAudioSource(input)
    before(); expect(registerEdge).not.toHaveBeenCalled()
    const source = {} as Processor, replacement = {} as Processor
    registry.register(target, detector, source)
    before(); before()
    expect(registerEdge).toHaveBeenCalledTimes(1)
    expect(edges.has(source)).toBe(true)
    p.reset(); p.processAudio(block)
    expect(p.audioOutput.getChannel(0)[0]).toBeCloseTo(0.01, 7)
    sideChain.targetVertex = Option.wrap({box: {address: later}}); changed()
    expect(edges.size).toBe(0)
    before(); expect(registerEdge).toHaveBeenCalledTimes(1)
    registry.register(later, detector, replacement); before(); before()
    expect(registerEdge).toHaveBeenCalledTimes(2)
    expect(edges.has(replacement)).toBe(true)
    sideChain.targetVertex = Option.None; changed(); before()
    expect(edges.size).toBe(0)
    p.reset(); p.processAudio(block)
    expect(p.audioOutput.getChannel(0)[0]).toBeLessThan(0.00001)
    sideChain.targetVertex = Option.wrap({box: {address: target}}); changed(); before()
    expect(edges.size).toBe(1)
    p.terminate(); expect(edges.size).toBe(0); expect(phases.size).toBe(0)
    before(); expect(registerEdge).toHaveBeenCalledTimes(3)
})
