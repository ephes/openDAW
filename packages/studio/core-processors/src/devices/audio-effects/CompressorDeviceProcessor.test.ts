import {beforeAll, expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Option, UUID} from "@opendaw/lib-std"
import {CompressorDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {Block} from "../../processing"
let Compressor: typeof import("./CompressorDeviceProcessor").CompressorDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Compressor = (await import("./CompressorDeviceProcessor")).CompressorDeviceProcessor})
const terminable = () => ({terminate() {}})
function fixture(auto: boolean, lookahead: boolean) {
    const address = Address.compose(UUID.generate())
    const params = {lookahead, automakeup: auto, autoattack: auto, autorelease: auto,
        inputgain: 0, threshold: -10, ratio: 4, knee: 6, attack: 2, release: 140, makeup: 0, mix: 1}
    const namedParameter = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, {
        address, getValue: () => value, subscribe: terminable, valueMapping: {x: (x: number) => x},
        field: {pointerHub: {catchupAndSubscribe: terminable}}
    }]))
    const adapter = {address, uuid: address.uuid, namedParameter,
        sideChain: {catchupAndSubscribe: terminable, targetVertex: Option.None}} as unknown as CompressorDeviceBoxAdapter
    const context = {broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: {register: terminable}, subscribeProcessPhase: terminable} as unknown as EngineContext
    const processor = new Compressor(context, adapter), input = new AudioBuffer()
    processor.setAudioSource(input)
    return {processor, input}
}
const block = (s0: number, s1: number): Block => ({index: 0, p0: 0, p1: 1, s0, s1, bpm: 120, flags: 0})
it.each([[false, false], [false, true], [true, false], [true, true]])("reset discards history (auto=%s, lookahead=%s)", (auto, lookahead) => {
        const warm = fixture(auto, lookahead), fresh = fixture(auto, lookahead)
        warm.input.channels().forEach((ch, c) => ch.fill(c ? -0.5 : 1))
        for (let i = 0; i < 10; i++) warm.processor.processAudio(block(0, 128))
        warm.processor.reset(); warm.input.clear()
        for (const [a, b] of [[0, 31], [31, 128], [0, 128], [0, 7], [7, 128]]) {
            warm.processor.processAudio(block(a, b)); fresh.processor.processAudio(block(a, b))
            warm.processor.audioOutput.channels().forEach((ch, c) => expect(ch).toEqual(fresh.processor.audioOutput.getChannel(c)))
        }
        warm.processor.reset()
        const freshSignal = fixture(auto, lookahead)
        for (const f of [warm, freshSignal]) f.input.channels().forEach((ch, c) => ch.fill(c ? -0.2 : 0.7))
        for (let i = 0; i < 6; i++) for (const [a, b] of [[0, 53], [53, 128]]) {
            warm.processor.processAudio(block(a, b)); freshSignal.processor.processAudio(block(a, b))
            warm.processor.audioOutput.channels().forEach((ch, c) => expect(ch).toEqual(freshSignal.processor.audioOutput.getChannel(c)))
        }
})
