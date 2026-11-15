import {beforeAll, expect, it} from "vitest"
import {AudioBuffer, StereoMatrix} from "@opendaw/lib-dsp"
import {DattorroReverbDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {DattorroReverbDsp} from "./DattorroReverbDsp"
import {processorFixture, block} from "../processor-test-fixture"
let Reverb: typeof import("./DattorroReverbDeviceProcessor").DattorroReverbDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Reverb = (await import("./DattorroReverbDeviceProcessor")).DattorroReverbDeviceProcessor})
const controls = {preDelay: 17, bandwidth: 0.8, inputDiffusion1: 0.7, inputDiffusion2: 0.6, decay: 0.6,
    decayDiffusion1: 0.65, decayDiffusion2: 0.45, damping: 0.15, excursionRate: 0.4, excursionDepth: 0.5,
    wet: 20 * Math.log10(0.25), dry: 20 * Math.log10(0.5)}
function fixture(values = controls) {
    const f = processorFixture()
    const p = new Reverb(f.context, {address: f.address, uuid: f.address.uuid,
        namedParameter: Object.fromEntries(Object.entries(values).map(([n, v]) => [n, f.field(v)]))} as unknown as DattorroReverbDeviceBoxAdapter)
    p.setAudioSource(f.input)
    return {...f, p}
}
const dspOracle = (rate: number) => {
    const dsp = new DattorroReverbDsp(rate)
    Object.assign(dsp, {preDelayMs: 17, bandwidth: 0.8, inputDiffusion1: 0.7, inputDiffusion2: 0.6, decay: 0.6,
        decayDiffusion1: 0.65, decayDiffusion2: 0.45, damping: 0.15, excursionRate: 0.4, excursionDepth: 0.5,
        wetGain: 0.25, dryGain: 0.5})
    return dsp
}
it.each([44100, 48000, 96000])("maps controls to the real DSP, preserves partitions and restarts (%i Hz)", rate => {
    Object.assign(globalThis, {sampleRate: rate})
    const whole = fixture(), split = fixture(), warm = fixture(), oracle = dspOracle(rate), expected = new AudioBuffer()
    warm.input.getChannel(0)[0] = 1
    for (let q = 0; q < 137; q++) {warm.p.processAudio(block()); warm.input.clear()}
    warm.p.reset(); warm.p.reset()
    let wetEnergy = 0, stereoDifference = 0
    for (let q = 0; q < 256; q++) {
        for (const f of [whole, split, warm]) {
            f.input.clear()
            if (q === 0) {f.input.getChannel(0)[0] = 1; f.input.getChannel(1)[13] = -0.25}
        }
        oracle.process(whole.input.channels() as StereoMatrix.Channels, expected.channels() as StereoMatrix.Channels, 0, 128)
        whole.p.processAudio(block()); warm.p.processAudio(block())
        whole.p.audioOutput.channels().forEach((ch, c) => {
            const error = ch.reduce((max, x, i) => Math.max(max, Math.abs(x - expected.getChannel(c)[i])), 0)
            expect(error).toBeLessThan(1e-7)
        })
        expect(warm.p.audioOutput.channels()).toEqual(whole.p.audioOutput.channels())
        for (const [s0, s1] of [[0, 7], [7, 17], [17, 48], [48, 109], [109, 128]]) {
            split.p.audioOutput.channels().forEach(ch => ch.fill(123))
            split.p.processAudio(block(s0, s1))
            split.p.audioOutput.channels().forEach((ch, c) => {
                expect(ch.subarray(0, s0).every(x => x === 123)).toBe(true)
                expect(ch.subarray(s1).every(x => x === 123)).toBe(true)
                expect(ch.slice(s0, s1)).toEqual(whole.p.audioOutput.getChannel(c).slice(s0, s1))
            })
        }
        if (q > 2) expected.getChannel(0).forEach((x, i) => {
            wetEnergy += x * x
            stereoDifference += Math.abs(x - expected.getChannel(1)[i])
        })
    }
    expect(wetEnergy).toBeGreaterThan(1e-6); expect(stereoDifference).toBeGreaterThan(1e-3)
    whole.p.terminate(); split.p.terminate(); warm.p.terminate()
})
it("routes unity dry stereo without wet crosstalk", () => {
    Object.assign(globalThis, {sampleRate: 48000})
    const f = fixture({...controls, wet: -Infinity, dry: 0})
    for (let q = 0; q < 12; q++) {
        f.input.channels().forEach((ch, c) => ch.forEach((_, i) => ch[i] = c === 0 ? Math.sin((q * 128 + i) / 23) : (i === 17 ? -0.75 : 0)))
        f.p.processAudio(block())
        expect(f.p.audioOutput.channels()).toEqual(f.input.channels())
    }
    f.p.terminate()
})
