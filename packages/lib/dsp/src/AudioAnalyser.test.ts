import {expect, it} from "vitest"
import {AudioAnalyser} from "./AudioAnalyser"
const signal = Float32Array.from({length: 256}, (_, i) => Math.sin(2 * Math.PI * 12 * i / 128))
function run(parts: number[], cancel = false) {
    const a = new AudioAnalyser({size: 64, decay: 0.5}), right = signal.map(x => cancel ? -x : x)
    let from = 0
    for (const count of parts) {a.process(signal, right, from, from + count); from += count}
    return a
}
it("finds a bin-centered sine and cancels anti-phase stereo independent of partitions", () => {
    const a = run([256]), split = run([3, 17, 80, 27, 1, 128])
    expect(split.bins()).toEqual(a.bins()); expect(split.waveform()).toEqual(a.waveform())
    const bins = Array.from(a.bins())
    expect(bins.indexOf(Math.max(...bins))).toBe(12); expect(bins[12]).toBeGreaterThan(0.8)
    expect(Array.from(run([256], true).bins())).toEqual(Array(64).fill(0))
})
it("gates decay and clears all spectral history before silence", () => {
    const a = run([256]), before = a.bins().slice(), zeros = new Float32Array(128)
    a.process(zeros, zeros, 0, 128); expect(a.bins()).toEqual(before)
    a.decay = true; a.process(zeros, zeros, 0, 128)
    a.bins().forEach((x, i) => expect(x).toBeCloseTo(before[i] * 0.5, 6))
    expect(a.decay).toBe(false)
    a.clear(); a.process(zeros, zeros, 0, 128)
    const fresh = new AudioAnalyser({size: 64}); fresh.process(zeros, zeros, 0, 128)
    expect(a.bins()).toEqual(fresh.bins()); expect(a.waveform()).toEqual(fresh.waveform())
})
