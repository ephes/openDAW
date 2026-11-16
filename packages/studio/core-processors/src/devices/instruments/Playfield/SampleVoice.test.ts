import {beforeAll, expect, it} from "vitest"
import {AudioData} from "@opendaw/lib-dsp"
import {Gate, PlayfieldSampleBoxAdapter} from "@opendaw/studio-adapters"
import {NoteLifecycleEvent} from "../../../NoteEventSource"
import {AutomatableParameters} from "./AutomatableParameters"

let SampleVoice: typeof import("./SampleVoice").SampleVoice
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    SampleVoice = (await import("./SampleVoice")).SampleVoice
}, 30000)
function voice(gate: Gate, start: number, end: number, rate = 1, length = 3) {
    const value = (n: number) => ({getValue: () => n})
    const parameters = {sampleStart: value(start), sampleEnd: value(end), attack: value(1 / sampleRate),
        release: value(1), pitch: value(0)} as unknown as AutomatableParameters
    const data = AudioData.create(sampleRate * rate, length, 1)
    const frames = data.frames
    frames[0].set(Float32Array.from({length}, (_, i) => (i + 1) / 4))
    const v = new SampleVoice({gate} as PlayfieldSampleBoxAdapter, parameters, data, NoteLifecycleEvent.start(0, 100, 60, 1))
    return {v, output: [new Float32Array(128), new Float32Array(128)], frames: frames[0]}
}
it.each([Gate.Off, Gate.On, Gate.Loop])("retires empty geometry in gate %i without output", gate => {
    for (const [start, end, length] of [[0.5, 0.5, 3], [0, 1, 1], [NaN, 1, 3], [0, Infinity, 3]]) {
        const {v, output} = voice(gate, start, end, 1, length)
        expect(v.processAdd(output, 0, 128)).toBe(true)
        expect(output.every(ch => ch.every(x => x === 0))).toBe(true)
    }
})
it.each([false, true])("wraps fractional overshoot with a modulo oracle, reverse=%s", reverse => {
    const start = reverse ? 0.50005 : 0.5, end = reverse ? 0.5 : 0.50005
    const {v, output} = voice(Gate.Loop, start, end, 4)
    const a = start * 2, b = end * 2, span = Math.abs(b - a), sign = Math.sign(b - a)
    let position = a
    for (let i = 0; i < 16; i++) {
        expect(v.processAdd(output, i, i + 1)).toBe(false)
        const travelled = sign * (position + sign * 4 - a)
        position = a + sign * (travelled - Math.floor(travelled / span) * span)
        expect(v.position).toBeCloseTo(position, 11)
    }
    expect(output.every(ch => ch.every(Number.isFinite))).toBe(true)
})
it.each([Gate.Off, Gate.On])("retires adjacent representable endpoints for gate %i", gate => {
    const {v, output} = voice(gate, 0.5, 0.5 + Number.EPSILON)
    expect(v.processAdd(output, 0, 128)).toBe(true)
    expect(output.every(ch => ch.every(Number.isFinite))).toBe(true)
})

it("keeps adjacent representable loops bounded at high pitch in either direction", () => {
    for (const [a, b] of [[0.5, 0.5 + Number.EPSILON], [0.5 + Number.EPSILON, 0.5]]) {
        const {v, output} = voice(Gate.Loop, a, b, 1024)
        expect(v.processAdd(output, 0, 128)).toBe(false)
        expect(v.position).toBeGreaterThanOrEqual(Math.min(a, b) * 2)
        expect(v.position).toBeLessThanOrEqual(Math.max(a, b) * 2)
        expect(output.every(ch => ch.every(Number.isFinite))).toBe(true)
    }
})
it.each([false, true])("includes every admitted one-shot frame against endpoint oracle, reverse=%s", reverse => {
    for (const rate of [0.25, 0.5, 1, 1.5]) {
        const {v, output, frames} = voice(Gate.Off, reverse ? 1 : 0, reverse ? 0 : 1, rate, 4)
        for (const [a, b] of [[0, 1], [1, 3], [3, 5], [5, 16]]) v.processAdd(output, a, b)
        const start = reverse ? 3 : 0, step = reverse ? -rate : rate
        const releaseAt = Math.max(0, Math.ceil(3 / rate) - 1)
        for (let i = 0; i < 16; i++) {
            const position = start + i * step, lo = Math.floor(position), fraction = position - lo
            const env = Math.min(i, 1 - Math.max(0, i - releaseAt - 1) / sampleRate, 1)
            const expected = position >= 0 && position < 4
                ? (frames[lo] * (1 - fraction) + (frames[lo + 1] ?? 0) * fraction) * env ** 2 : 0
            expect(output[0][i], `rate=${rate}, frame=${i}`).toBeCloseTo(expected, 7)
            expect(output[1][i]).toBe(output[0][i])
        }
    }
})
