import {expect, it} from "vitest"
import {VocoderDsp} from "./VocoderDsp"

type Mode = "stereo" | "mono" | "self"
const modes: Mode[] = ["stereo", "mono", "self"]
function signal() {
    const buffers = Array.from({length: 6}, () => new Float32Array(128))
    for (let i = 0; i < 128; i++) {
        buffers[0][i] = Math.sin(i * 0.37) * 0.7
        buffers[1][i] = Math.cos(i * 0.17) * 0.3
        buffers[2][i] = Math.sin(i * 0.11) * 0.9
        buffers[3][i] = Math.cos(i * 0.23) * 0.5
    }
    return buffers
}
function process(dsp: VocoderDsp, mode: Mode, b: Float32Array[], from = 0, to = 128) {
    const [l, r, ml, mr, ol, or] = b
    if (mode === "stereo") dsp.processStereoMod(l, r, ml, mr, ol, or, from, to)
    else if (mode === "mono") dsp.processMonoMod(l, r, ml, ol, or, from, to)
    else dsp.processSelf(l, r, ol, or, from, to)
}
function targets(dsp: VocoderDsp) {
    dsp.bandCount = 12
    dsp.carrierMinFreq = 160; dsp.carrierMaxFreq = 8000
    dsp.modulatorMinFreq = 240; dsp.modulatorMaxFreq = 6000
    dsp.qMin = 3; dsp.qMax = 12
}
function close(a: Float32Array[], b: Float32Array[], from = 0, to = 128) {
    for (const ch of [4, 5]) for (let i = from; i < to; i++) {
        expect(Number.isFinite(a[ch][i])).toBe(true)
        // State is stored in Float32Arrays at each invocation boundary.
        expect(Math.abs(a[ch][i] - b[ch][i])).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(b[ch][i])))
    }
}
it.each(modes)("%s interpolation advances by samples across repeated irregular spans", mode => {
    const whole = new VocoderDsp(48000), split = new VocoderDsp(48000), a = signal(), b = signal()
    for (let q = 0; q < 3; q++) {process(whole, mode, a); process(split, mode, b)}
    targets(whole); targets(split)
    for (let q = 0; q < 32; q++) {
        process(whole, mode, a)
        const cuts = q % 2 === 0 ? [0, 7, 31, 128] : [0, 1, 64, 65, 101, 128]
        for (let j = 1; j < cuts.length; j++) process(split, mode, b, cuts[j - 1], cuts[j])
        close(a, b)
    }
})
it.each(modes)("%s keeps its sample clock when automation changes inside a subblock", mode => {
    const a = new VocoderDsp(48000), b = new VocoderDsp(48000), x = signal(), y = signal()
    for (let q = 0; q < 4; q++) {process(a, mode, x); process(b, mode, y)}
    process(a, mode, x, 0, 17); process(b, mode, y, 0, 7); process(b, mode, y, 7, 17)
    targets(a); targets(b)
    process(a, mode, x, 17, 128)
    for (const [s, e] of [[17, 31], [31, 64], [64, 97], [97, 128]]) process(b, mode, y, s, e)
    close(x, y)
})
it.each(modes)("%s restart snaps the current target layout, coefficients and fades", mode => {
    const warm = new VocoderDsp(48000), fresh = new VocoderDsp(48000), a = signal(), b = signal()
    for (let q = 0; q < 8; q++) process(warm, mode, a)
    warm.bandCount = 8; warm.qMax = 30; warm.carrierMaxFreq = 4000
    process(warm, mode, a, 0, 31)
    targets(warm); process(warm, mode, a, 31, 53)
    targets(fresh); warm.reset(); warm.reset(); fresh.reset()
    for (let q = 0; q < 8; q++) {
        for (const [s, e] of [[0, 7], [7, 31], [31, 128]]) {
            process(warm, mode, a, s, e); process(fresh, mode, b, s, e)
            for (const ch of [4, 5]) expect(a[ch].slice(s, e)).toEqual(b[ch].slice(s, e))
        }
    }
    a.forEach(ch => ch.fill(0)); b.forEach(ch => ch.fill(0))
    warm.reset(); fresh.reset()
    process(warm, mode, a); process(fresh, mode, b)
    close(a, b)
    expect(a[4]).toEqual(new Float32Array(128))
    expect(a[5]).toEqual(new Float32Array(128))
})
