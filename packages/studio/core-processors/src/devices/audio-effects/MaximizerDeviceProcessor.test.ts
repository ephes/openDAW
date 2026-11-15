import {beforeAll, expect, it} from "vitest"
import {MaximizerDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {processorFixture, block} from "../processor-test-fixture"
let Maximizer: typeof import("./MaximizerDeviceProcessor").MaximizerDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Maximizer = (await import("./MaximizerDeviceProcessor")).MaximizerDeviceProcessor})
function fixture(lookAhead = true, thresholdDb = -12) {
    const f = processorFixture(), lookahead = f.field(lookAhead), threshold = f.field(thresholdDb)
    const p = new Maximizer(f.context, {address: f.address, uuid: f.address.uuid,
        namedParameter: {threshold}, box: {lookahead}} as unknown as MaximizerDeviceBoxAdapter)
    p.setAudioSource(f.input)
    return {...f, p, lookahead, threshold}
}
it("retires queued stereo audio and published reduction across latency mode changes", () => {
    const f = fixture()
    f.input.getChannel(0)[0] = 0.9; f.input.getChannel(1)[13] = -0.3
    f.p.processAudio(block())
    const reduction = f.streams.find(s => s.values.length === 1)!
    reduction.publish(true); expect(reduction.values[0]).toBeLessThan(0)
    f.lookahead.setValue(false)
    expect(reduction.values[0]).toBe(0)
    f.input.clear()
    for (let q = 0; q < 32; q++) f.p.processAudio(block())
    f.lookahead.setValue(true)
    for (let q = 0; q < 8; q++) {
        f.p.processAudio(block())
        expect(f.p.audioOutput.channels().every(ch => ch.every(x => x === 0))).toBe(true)
    }
    reduction.publish(true); expect(reduction.values[0]).toBe(0)
    f.input.getChannel(0)[0] = 0.01
    const rendered: number[] = []
    for (let q = 0; q < 5; q++) {
        f.p.processAudio(block()); rendered.push(...f.p.audioOutput.getChannel(0)); f.input.clear()
    }
    expect(rendered.findIndex(x => x !== 0)).toBe(Math.ceil(sampleRate * 0.005))
    f.p.terminate()
})
it("retires peak hold on leaving lookahead while preserving threshold controls", () => {
    const warm = fixture(), fresh = fixture(false)
    warm.input.channels().forEach(ch => ch.fill(0.9)); warm.p.processAudio(block())
    warm.lookahead.setValue(false)
    for (const f of [warm, fresh]) f.input.channels().forEach(ch => ch.fill(0.001))
    warm.p.processAudio(block()); fresh.p.processAudio(block())
    expect(warm.p.audioOutput.channels()).toEqual(fresh.p.audioOutput.channels())
    warm.p.terminate(); fresh.p.terminate()
})
function render(f: ReturnType<typeof fixture>, signal: (frame: number, channel: number) => number, split = false, automate = false) {
    const result: number[][] = [[], []]
    for (let q = 0; q < 16; q++) {
        if (automate && q === 3) f.threshold.setValue(-6)
        if (automate && q === 7) f.threshold.setValue(-18)
        f.input.channels().forEach((ch, c) => ch.forEach((_, i) => ch[i] = signal(q * 128 + i, c)))
        for (const [s0, s1] of split ? [[0, 17], [17, 48], [48, 109], [109, 128]] : [[0, 128]]) {
            f.p.audioOutput.channels().forEach(ch => ch.fill(123))
            f.p.processAudio(block(s0, s1))
            f.p.audioOutput.channels().forEach((ch, c) => {
                expect(ch.subarray(0, s0).every(x => x === 123)).toBe(true)
                expect(ch.subarray(s1).every(x => x === 123)).toBe(true)
                result[c].push(...ch.subarray(s0, s1))
            })
        }
    }
    return result
}
for (const rate of [44100, 48000, 96000]) for (const mode of [false, true]) {
    it(`matches independent static gain and exact latency (${rate} Hz, lookahead=${mode})`, () => {
        Object.assign(globalThis, {sampleRate: rate})
        const f = fixture(mode)
        const signal = (n: number, c: number) => c === 0 ? 0.05 + 0.02 * Math.sin(n / 19) : (n === 13 ? -0.1 : 0)
        const output = render(f, signal)
        const latency = mode ? Math.ceil(0.005 * rate) : 0
        const gain = 10 ** ((12 - 0.001) / 20)
        for (let c = 0; c < 2; c++) output[c].forEach((x, i) =>
            expect(x).toBeCloseTo(i < latency ? 0 : signal(i - latency, c) * gain, 7))
        expect(output[0].findIndex(x => x !== 0)).toBe(latency)
        expect(output[1].findIndex(x => x !== 0)).toBe(latency + 13)
        f.p.terminate()
    })
    it(`links stereo gain and bounds settled headroom (${rate} Hz, lookahead=${mode})`, () => {
        Object.assign(globalThis, {sampleRate: rate})
        const f = fixture(mode), output = render(f, (_n, c) => c === 0 ? 0.2 : -0.8)
        const ceiling = 10 ** (-0.001 / 20)
        expect(output[1][2047]).toBeCloseTo(-ceiling, 6)
        expect(output[0][2047]).toBeCloseTo(ceiling / 4, 6)
        output[0].forEach((x, i) => expect(output[1][i]).toBeCloseTo(-4 * x, 6))
        if (mode) expect(Math.max(...output.flat().map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6)
        f.p.terminate()
    })
    it(`preserves irregular partitions during threshold automation (${rate} Hz, lookahead=${mode})`, () => {
        Object.assign(globalThis, {sampleRate: rate})
        const whole = fixture(mode), split = fixture(mode)
        const signal = (n: number, c: number) => Math.sin(n / 13) * (c === 0 ? 0.007 : -0.0035)
        const a = render(whole, signal, false, true), b = render(split, signal, true, true)
        expect(b).toEqual(a)
        const latency = mode ? Math.ceil(0.005 * rate) : 0
        const settledGain = 10 ** ((18 - 0.001) / 20)
        for (let c = 0; c < 2; c++) expect(b[c][2047]).toBeCloseTo(signal(2047 - latency, c) * settledGain, 7)
        expect(b.flat().every(Number.isFinite)).toBe(true)
        if (mode) expect(Math.max(...b.flat().map(Math.abs))).toBeLessThanOrEqual(1)
        whole.p.terminate(); split.p.terminate()
    })
}
