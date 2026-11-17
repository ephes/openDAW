import {beforeAll, expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {DefaultObservableValue, Option, UUID} from "@opendaw/lib-std"
import {CompressorDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {Block} from "../../processing"
let Compressor: typeof import("./CompressorDeviceProcessor").CompressorDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Compressor = (await import("./CompressorDeviceProcessor")).CompressorDeviceProcessor})
const terminable = () => ({terminate() {}})
function fixture(auto: boolean, lookahead: boolean, options: Partial<{automakeup: boolean, autoattack: boolean, autorelease: boolean}> = {}) {
    const address = Address.compose(UUID.generate())
    const params = {lookahead, automakeup: auto, autoattack: auto, autorelease: auto,
        inputgain: 0, threshold: -10, ratio: 4, knee: 6, attack: 2, release: 140, makeup: 0, mix: 1, ...options}
    const namedParameter = Object.fromEntries(Object.entries(params).map(([name, value]) => [name,
        Object.assign(new DefaultObservableValue(value), {address, valueMapping: {x: (x: number) => x},
            field: {pointerHub: {catchupAndSubscribe: terminable}}})]))
    const adapter = {address, uuid: address.uuid, namedParameter,
        sideChain: {catchupAndSubscribe: terminable, targetVertex: Option.None}} as unknown as CompressorDeviceBoxAdapter
    const context = {broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: {register: terminable}, subscribeProcessPhase: terminable} as unknown as EngineContext
    const processor = new Compressor(context, adapter), input = new AudioBuffer()
    processor.setAudioSource(input)
    return {processor, input, setAutomakeup: (value: boolean) => {
        namedParameter.automakeup.setValue(value)
    }}
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

const partitions = [0, 1, 9, 10, 31, 67, 68, 113, 128]
const randomPartitions = () => {
    const boundaries = [0]
    let seed = 135
    while (boundaries[boundaries.length - 1] < 128) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        boundaries.push(Math.min(128, boundaries[boundaries.length - 1] + 1 + seed % 23))
    }
    return boundaries
}
function renderAutomatic(options: Partial<{automakeup: boolean, autoattack: boolean, autorelease: boolean}>, boundaries: number[], late = false, lookahead = false) {
    const f = fixture(false, lookahead, options)
    const result: number[] = []
    for (let q = 0; q < 12; q++) {
        f.input.channels().forEach((channel, c) => channel.forEach((_, i) => {
            const n = q * 128 + i
            channel[i] = n < 96 ? 0.01 : (late && n >= 400 ? 0.001 :
                (n % 193 < 7 ? 0.95 : 0.08) * Math.sin(n * 0.17)) * (c ? -0.6 : 1)
        }))
        for (let b = 1; b < boundaries.length; b++) f.processor.processAudio(block(boundaries[b - 1], boundaries[b]))
        result.push(...f.processor.audioOutput.getChannel(0))
    }
    f.processor.terminate()
    return result
}
it.each([[true, false], [false, true], [true, true]])("causal auto ballistics follow samples (attack=%s, release=%s)", (autoattack, autorelease) => {
    const options = {autoattack, autorelease, automakeup: false}
    const whole = renderAutomatic(options, [0, 128])
    for (const spans of [partitions, randomPartitions()]) expect(renderAutomatic(options, spans)).toEqual(whole)
    // Editing future detector samples must not change an earlier gain.
    expect(renderAutomatic(options, [0, 128], true).slice(0, 400)).toEqual(whole.slice(0, 400))
})

it.each([false, true])("automatic makeup follows sample time (auto ballistics=%s)", auto => {
    const options = {automakeup: true, autoattack: auto, autorelease: auto}
    for (const lookahead of [false, true]) {
        const whole = renderAutomatic(options, [0, 128], false, lookahead)
        for (const spans of [partitions, randomPartitions()]) expect(renderAutomatic(options, spans, false, lookahead)).toEqual(whole)
        if (!lookahead) expect(renderAutomatic(options, [0, 128], true).slice(0, 400)).toEqual(whole.slice(0, 400))
    }
})

it("makeup retains the quantum time constant and a causal per-sample recurrence", () => {
    const f = fixture(false, false, {automakeup: true})
    f.input.channels().forEach(ch => ch.fill(0.5))
    f.processor.processAudio(block(0, 128))
    const target = Math.fround(-0.75 * (20 * Math.log10(0.5) + 10))
    const alpha = Math.exp(-1 / (48000 * 0.002))
    const weight = 1 - Math.pow(0.97, 1 / 128)
    let envelope = 0, makeup = 0
    f.processor.audioOutput.getChannel(0).forEach((value, i) => {
        envelope = alpha * envelope + (1 - alpha) * target
        const attenuation = Math.fround(envelope)
        if (i === 0) makeup = -attenuation
        makeup = weight * -attenuation + (1 - weight) * makeup
        expect(value).toBeCloseTo(0.5 * Math.pow(10, (attenuation + Math.fround(makeup)) / 20), 6)
    })
    f.processor.terminate()
})
it("disabled makeup tracks history for re-enable and empty spans do not advance it", () => {
    const disabled = fixture(false, false), enabled = fixture(false, false, {automakeup: true})
    for (const f of [disabled, enabled]) f.input.channels().forEach(ch => ch.fill(0.8))
    for (let q = 0; q < 4; q++) for (const f of [disabled, enabled]) f.processor.processAudio(block(0, 128))
    expect(disabled.processor.audioOutput.getChannel(0)[127]).toBeLessThan(enabled.processor.audioOutput.getChannel(0)[127])
    disabled.setAutomakeup(true)
    for (const s of [0, 7, 128]) disabled.processor.processAudio(block(s, s))
    for (const f of [disabled, enabled]) f.processor.processAudio(block(0, 128))
    expect(disabled.processor.audioOutput.channels()).toEqual(enabled.processor.audioOutput.channels())
    disabled.processor.terminate(); enabled.processor.terminate()
})
