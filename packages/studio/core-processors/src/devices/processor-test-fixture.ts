import {Address} from "@opendaw/lib-box"
import {DefaultObservableValue, Terminable, UUID} from "@opendaw/lib-std"
import {AudioBuffer, PPQN} from "@opendaw/lib-dsp"
import {EngineContext} from "../EngineContext"
import {Block, BlockFlag} from "../processing"

// Synthetic adapter fields; processors, parameter subscriptions and DSP stay real.
export const processorFixture = () => {
    const address = Address.compose(UUID.generate())
    const streams: {address: Address, values: Float32Array, publish: (active: boolean) => void}[] = []
    const floats: (() => number)[] = []
    const context = {registerProcessor: () => Terminable.Empty,
        audioOutputBufferRegistry: {register: () => Terminable.Empty},
        broadcaster: {
            broadcastFloats: (address: Address, values: Float32Array, publish: (active: boolean) => void) => {
                streams.push({address, values, publish}); return Terminable.Empty
            },
            broadcastFloat: (_address: Address, read: () => number) => {floats.push(read); return Terminable.Empty},
            broadcastIntegers: () => Terminable.Empty
        }} as unknown as EngineContext
    const field = (initial: number | boolean) => Object.assign(new DefaultObservableValue(initial), {
        address, valueMapping: {x: (x: number | boolean) => Number(x)},
        field: {pointerHub: {catchupAndSubscribe: () => Terminable.Empty}}
    })
    const input = new AudioBuffer()
    return {address, context, streams, floats, field, input}
}
export const block = (s0 = 0, s1 = 128, p0 = 0, bpm = 120): Block => ({index: 0, s0, s1, p0,
    p1: p0 + PPQN.samplesToPulses(s1 - s0, bpm, sampleRate), bpm,
    flags: BlockFlag.playing | BlockFlag.transporting})
