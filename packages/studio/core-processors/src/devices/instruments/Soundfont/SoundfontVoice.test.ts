import {beforeAll, expect, it} from "vitest"
import type {InstrumentZone, PresetZone, SoundFont2} from "soundfont2"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {NoteLifecycleEvent} from "../../../NoteEventSource"
import {GeneratorType} from "./GeneratorType"

let SoundfontVoice: typeof import("./SoundfontVoice").SoundfontVoice
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    SoundfontVoice = (await import("./SoundfontVoice")).SoundfontVoice
}, 30000)
function voice(mode: number, loopStart = 16, loopEnd = 32, rate = 1, length = 128) {
    const data = Int16Array.from({length}, (_, i) => i < 32 ? 12000 : -12000)
    const sample = {data, header: {sampleRate: sampleRate * rate, originalPitch: 60, startLoop: loopStart, endLoop: loopEnd}}
    const inst = {sample, generators: {
        [GeneratorType.SampleModes]: {value: mode}, [GeneratorType.AttackVolEnv]: {value: -24000},
        [GeneratorType.DecayVolEnv]: {value: -24000}, [GeneratorType.ReleaseVolEnv]: {value: 0}}} as unknown as InstrumentZone
    const v = new SoundfontVoice(NoteLifecycleEvent.start(0, 1000, 60, 1),
        {generators: {}} as PresetZone, inst, {samples: [sample]} as unknown as SoundFont2)
    return {v, output: new AudioBuffer(), data}
}
it.each([0, 1, 3])("preserves held/released sample mode %i across partitions", mode => {
    const render = (parts: number[]) => {
        const {v, output} = voice(mode)
        const held: number[] = [], released: number[] = []
        let done = false
        for (const n of [17, 31, 48]) {
            output.clear(); done = v.processAdd(output, 0, n)
            held.push(...output.getChannel(0).subarray(0, n))
        }
        expect(done).toBe(false)
        expect(held.some(x => x < 0)).toBe(mode === 0)
        v.release()
        for (const n of parts) {
            output.clear()
            if (!done) done = v.processAdd(output, 0, n)
            released.push(...output.getChannel(0).subarray(0, n))
        }
        expect(done).toBe(mode !== 1)
        expect(released.some(x => x < 0)).toBe(mode !== 1)
        expect(released.every(Number.isFinite)).toBe(true)
        return released
    }
    const whole = render([128]), split = render([1, 7, 41, 79])
    split.forEach((x, i) => expect(x).toBeCloseTo(whole[i], 8))
})
it.each([5.5, 17, 1024, 1e9])("wraps arbitrary finite overshoot at rate %s", rate => {
    const {v, output, data} = voice(1, 16, 19, rate)
    let position = 0
    for (let i = 0; i < 64; i++) {
        expect(v.playbackPosition).toBeGreaterThanOrEqual(0)
        expect(v.playbackPosition).toBeLessThan(data.length)
        output.clear(); expect(v.processAdd(output, 0, 1)).toBe(false)
        const next = position + rate
        position = next < 19 ? next : 16 + (next - 16 - Math.floor((next - 16) / 3) * 3)
        expect(v.playbackPosition).toBeCloseTo(position, 8)
        expect(output.channels().every(ch => ch.every(Number.isFinite))).toBe(true)
    }
})
it.each([[-1, 32], [16, 16], [32, 16], [16, 129], [NaN, 32], [16, Infinity], [0.5, 32]])(
    "falls back to nonlooping playback for invalid bounds %s..%s", (start, end) => {
        const {v, output} = voice(1, start, end)
        expect(v.shouldLoop).toBe(false)
        expect(v.processAdd(output, 0, 128)).toBe(true)
        expect(output.channels().every(ch => ch.every(Number.isFinite))).toBe(true)
    })
it("retires an empty sample without reading invalid positions", () => {
    const {v, output} = voice(1, 0, 0, 1, 0)
    expect(v.processAdd(output, 0, 128)).toBe(true)
    expect(output.channels().every(ch => ch.every(x => x === 0))).toBe(true)
})
it.each([0, -1, NaN, Infinity])("retires invalid playback rate %s without output", rate => {
    const {v, output} = voice(1, 16, 32, rate)
    expect(v.processAdd(output, 0, 128)).toBe(true)
    expect(output.channels().every(ch => ch.every(x => x === 0))).toBe(true)
})
it("keeps valid one-frame loops in range and unsupported modes nonlooping", () => {
    const {v, output} = voice(1, 0, 1, 1024, 1)
    expect(v.processAdd(output, 0, 128)).toBe(false)
    expect(v.playbackPosition).toBe(0)
    expect(output.channels().every(ch => ch.every(Number.isFinite))).toBe(true)
    expect(voice(2).v.shouldLoop).toBe(false)
})
it("retires an invalid zone while another valid voice keeps rendering", () => {
    const bad = voice(1, 4, 4), good = voice(1)
    const output = new AudioBuffer()
    expect(bad.v.processAdd(output, 0, 128)).toBe(true)
    output.clear()
    expect(good.v.processAdd(output, 0, 128)).toBe(false)
    expect(output.getChannel(0).some(x => x > 0)).toBe(true)
    expect(output.channels().every(ch => ch.every(Number.isFinite))).toBe(true)
})
