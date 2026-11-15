import {afterEach, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {FFT} from "@opendaw/lib-dsp"
import {tensor, Tensor} from "../Tensor"
import {TempoDetectionTask} from "./TempoDetectionTask"

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
const valid = () => {
    const data = new Float32Array(256)
    data[77 - 30] = 0.6
    data[154 - 30] = 0.4
    return tensor("float32", data, [1, 256])
}
const run = (output: Tensor, audio = new Float32Array(1024), sampleRate = 11025) => {
    const session = vi.fn(async () => ({output}))
    const progress = vi.fn()
    return {session, progress, result: TempoDetectionTask.run({audio, sampleRate}, {
        session, progress, signal: Option.None, inputNames: ["input"], outputNames: ["output"]
    })}
}
it.each([
    tensor("float32", new Float32Array(255), [1, 256]),
    tensor("int32", new Int32Array(256), [1, 256]),
    tensor("float32", new Int32Array(256), [1, 256]),
    tensor("float32", new Float32Array(256), [256]),
    tensor("float32", new Float32Array(256), [2, 128]),
    tensor("float32", new Float32Array(256).fill(NaN), [1, 256]),
    tensor("float32", new Float32Array(256).fill(-1), [1, 256]),
    tensor("float32", new Float32Array(256).fill(Infinity), [1, 256]),
    tensor("float32", new Float32Array(256), [1, 256]),
    tensor("float32", new Float32Array(256).fill(1), [1, 256])
])("refuses invalid tempo probabilities %#", async output => {
    const {result, progress} = run(output)
    await expect(result).rejects.toThrow(/tempo-cnn.*output/)
    expect(progress).not.toHaveBeenCalled()
})
it("retains octave handling for a valid probability distribution", async () => {
    const {result} = run(valid())
    expect(await result).toMatchObject({bpm: 154, confidence: expect.closeTo(0.4), topCandidates: [{bpm: 77, probability: expect.closeTo(0.6)}, {bpm: 154, probability: expect.closeTo(0.4)}, {bpm: 30, probability: 0}]})
})
it.each([NaN, Infinity, -Infinity])("refuses nonfinite PCM %s before inference", async value => {
    const audio = new Float32Array(1024)
    audio[100] = value
    const {result, session} = run(valid(), audio)
    await expect(result).rejects.toThrow(/finite PCM/)
    expect(session).not.toHaveBeenCalled()
})
it("refuses duration beyond thirty minutes before preprocessing", async () => {
    const audio = new Float32Array(11025 * 1800 + 1)
    const fft = vi.spyOn(FFT.prototype, "process")
    const {result, session} = run(valid(), audio)
    await expect(result).rejects.toThrow(/30 minutes/)
    expect(fft).not.toHaveBeenCalled()
    expect(session).not.toHaveBeenCalled()
})
it("yields during preprocessing so cancellation stops before model invocation", async () => {
    // Each clock read advances 1 ms, so the 8 ms work budget expires every eight checks.
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => ++now)
    const controller = new AbortController()
    const original = FFT.prototype.process
    let calls = 0
    vi.spyOn(FFT.prototype, "process").mockImplementation(function(this: FFT, real, imag) {
        if (++calls === 1) {setTimeout(() => controller.abort(new Error("synthetic stop")), 0)}
        return original.call(this, real, imag)
    })
    const session = vi.fn(async () => ({output: valid()}))
    await expect(TempoDetectionTask.run({audio: new Float32Array(11025 * 20), sampleRate: 11025}, {
        session, progress: () => {}, signal: Option.wrap(controller.signal), inputNames: ["input"], outputNames: ["output"]
    })).rejects.toThrow("synthetic stop")
    expect(calls).toBeLessThanOrEqual(16)
    expect(session).not.toHaveBeenCalled()
})
it("bounds feature allocations independently of track length", async () => {
    const audio = new Float32Array(11025 * 60)
    const allocations: number[] = []
    const Original = Float32Array
    vi.stubGlobal("Float32Array", class extends Original {
        constructor(length: number) {super(length); allocations.push(length)}
    })
    const {result, session} = run(valid(), audio)
    await result
    expect(session.mock.calls.length).toBeGreaterThan(1)
    expect(Math.max(...allocations)).toBeLessThanOrEqual(40 * 513)
})
it("yields on a work-time budget rather than after every small batch", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0)
    const timeout = vi.spyOn(globalThis, "setTimeout")
    const {result} = run(valid(), new Float32Array(11025 * 20))
    await result
    expect(timeout).not.toHaveBeenCalled()
})
