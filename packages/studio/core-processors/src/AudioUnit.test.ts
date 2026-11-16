import {expect, it, vi} from "vitest"
import {Option, Terminable} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import {AudioUnit} from "./AudioUnit"
import {AudioUnitOptions} from "./AudioUnitOptions"
import {EngineContext} from "./EngineContext"

const mocks = vi.hoisted(() => ({midi: vi.fn(), audio: vi.fn(), create: vi.fn()}))
vi.mock("./AudioBusProcessor", () => ({AudioBusProcessor: class {}}))
vi.mock("./MidiDeviceChain", () => ({MidiDeviceChain: class {
    invalidateWiring = mocks.midi
    terminate() {}
}}))
vi.mock("./AudioDeviceChain", () => ({AudioDeviceChain: class {
    invalidateWiring = mocks.audio
    terminate() {}
}}))
vi.mock("./DeviceProcessorFactory", () => ({InstrumentDeviceProcessorFactory: {create: mocks.create}}))
vi.mock("./FrozenPlaybackProcessor", () => ({FrozenPlaybackProcessor: class {
    readonly audioOutput = {value: 7}
    readonly registration: Terminable
    readonly edge: Terminable
    constructor(context: EngineContext, data: {fail?: boolean}) {
        this.registration = context.registerProcessor(this as never)
        this.edge = context.registerEdge(this as never, this as never)
        if (data.fail) throw new Error("synthetic construction failure")
    }
    terminate() {this.audioOutput.value = 0; this.edge.terminate(); this.registration.terminate()}
}}))

it.each(["input", "frozen"])("preserves the previous %s owner and unwinds failed construction before retry", kind => {
    mocks.midi.mockClear(); mocks.audio.mockClear()
    let processors = 0, edges = 0
    const context = {
        registerProcessor: () => {processors++; return {terminate: () => {processors--}}},
        registerEdge: () => {edges++; return {terminate: () => {edges--}}}
    } as unknown as EngineContext
    let notify: (owner: Option<never>) => void = () => {}
    const sources: Array<{audioOutput: {value: number}, terminate: () => void}> = []
    mocks.create.mockImplementation((context: EngineContext, request: {fail?: boolean}) => {
        const source = {audioOutput: {value: 5}, terminate: vi.fn(() => {source.audioOutput.value = 0; edge.terminate(); registration.terminate()})}
        const registration = context.registerProcessor(source as never)
        const edge = context.registerEdge(source as never, source as never)
        sources.push(source)
        if (request.fail) throw new Error("synthetic construction failure")
        return source
    })
    const adapter = {input: {catchupAndSubscribe: (callback: typeof notify) => {
        notify = callback; callback(Option.None); return {terminate() {}}
    }}} as unknown as AudioUnitBoxAdapter
    const unit = new AudioUnit(context, adapter, {...AudioUnitOptions.Default, useInstrumentOutput: true})
    const replace = (fail = false) => {
        if (kind === "input") notify(Option.wrap({box: {box: {fail}}}) as Option<never>)
        else unit.setFrozenAudio(Option.wrap({fail}) as unknown as Option<AudioData>)
    }
    const current = () => kind === "input" ? unit.input().unwrap() : unit.frozen.unwrap().processor
    replace()
    const previous = current(), output = previous.audioOutput
    mocks.midi.mockClear(); mocks.audio.mockClear()
    expect(() => replace(true)).toThrow("synthetic construction failure")
    expect(current()).toBe(previous); expect(current().audioOutput).toBe(output)
    expect((output as unknown as {value: number}).value).toBe(kind === "input" ? 5 : 7)
    expect(processors).toBe(1); expect(edges).toBe(1)
    expect(mocks.midi).not.toHaveBeenCalled(); expect(mocks.audio).not.toHaveBeenCalled()
    replace()
    expect(current()).not.toBe(previous)
    expect(processors).toBe(1); expect(edges).toBe(1)
    if (kind === "input") expect(sources[0].terminate).toHaveBeenCalledOnce()
    unit.terminate()
    expect(processors).toBe(0); expect(edges).toBe(0)
})
