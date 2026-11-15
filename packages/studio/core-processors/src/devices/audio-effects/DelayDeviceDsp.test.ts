import {beforeAll, expect, it} from "vitest"
import {StereoMatrix} from "@opendaw/lib-dsp"
let DelayDsp: typeof import("./DelayDeviceDsp").DelayDeviceDsp
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    DelayDsp = (await import("./DelayDeviceDsp")).DelayDeviceDsp
})
const stereo = (): StereoMatrix.Channels => [new Float32Array(128), new Float32Array(128)]
it.each([44100, 48000, 96000])("uses linked 50 ms attack and 250 ms release at %s Hz", rate => {
    Object.assign(globalThis, {sampleRate: rate})
    const dsp = new DelayDsp(256), input = stereo(), output = stereo()
    dsp.offset = 1; dsp.feedback = 0; dsp.filter = 0; dsp.wet = 1; dsp.dry = 0
    const overload = Math.round(rate * 0.1), silence = Math.round(rate * 0.05)
    const attackEnd = 4 * (1 - Math.exp(-overload / (rate * 0.05)))
    const silenceEnd = attackEnd * Math.exp(-silence / (rate * 0.25))
    const total = overload + silence + 256
    for (let start = 0; start < total; start += 128) {
        const count = Math.min(128, total - start)
        for (let i = 0; i < count; i++) {
            const n = start + i
            input[0][i] = n < overload ? 4 : n < overload + silence ? 0 : 0.5
            input[1][i] = input[0][i] * 0.5
        }
        dsp.process(input, output, 0, count)
        for (let i = 0; i < count; i++) {
            const n = start + i // The configured one-sample delay starts with silence.
            const signal = n === 0 ? 0 : n <= overload ? 4 : n <= overload + silence ? 0 : 0.5
            const envelope = n <= overload ? 4 * (1 - Math.exp(-n / (rate * 0.05)))
                : n <= overload + silence ? attackEnd * Math.exp(-(n - overload) / (rate * 0.25))
                    : 0.5 + (silenceEnd - 0.5) * Math.exp(-(n - overload - silence) / (rate * 0.25))
            const expected = signal * 0.96 / Math.max(1, envelope)
            expect(output[0][i]).toBeCloseTo(expected, 6)
            expect(output[1][i]).toBeCloseTo(expected * 0.5, 6)
        }
    }
})
it("resets modulation history to a fresh configured device across split spans", () => {
    Object.assign(globalThis, {sampleRate: 48000})
    function configured() {
        const dsp = new DelayDsp(512)
        dsp.offset = 23; dsp.filter = 0; dsp.feedback = 0.4
        dsp.lfoDepth = 40; dsp.lfoPhaseIncr = 1 / 97; dsp.wet = 1; dsp.dry = 0
        dsp.preDelayLeftOffset = 3; dsp.preDelayRightOffset = 7
        return dsp
    }
    const warm = configured(), fresh = configured(), input = stereo(), a = stereo(), b = stereo()
    input.forEach(ch => ch.fill(0.7))
    for (let i = 0; i < 32; i++) warm.process(input, a, 0, 128)
    warm.reset(); warm.reset()
    for (let quantum = 0; quantum < 8; quantum++) {
        input.forEach(ch => ch.fill(0))
        if (quantum === 0) {input[0][0] = 1; input[1][0] = -0.5}
        for (const [s0, s1] of [[0, 7], [7, 31], [31, 128]]) {
            warm.process(input, a, s0, s1); fresh.process(input, b, s0, s1)
            a.forEach((ch, c) => expect(ch.slice(s0, s1)).toEqual(b[c].slice(s0, s1)))
        }
    }
})
