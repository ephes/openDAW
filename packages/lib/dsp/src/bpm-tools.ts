import {assert, int} from "@opendaw/lib-std"

/**
 * BPM detector (90-180 BPM) for a mono Float32Array.
 * Port of Mark Hills bpm(1) with a light "low-BPM penalty" to dodge ½-tempo aliases.
 */
export namespace BPMTools {
    type Options = Partial<{
        interval: number
        scanSteps: number
        scanSamples: number
        minBPM: number
        maxBPM: number
    }>

    export function detect(buf: Float32Array, sampleRate: number, options: Options = {}): number {
        const {
            interval = 64,      // samples between energy taps
            scanSteps = 1_024,   // coarse grid
            scanSamples = 2_048,   // autodiff averages / point
            minBPM = 90,
            maxBPM = 180
        } = options
        assert([sampleRate, minBPM, maxBPM].every(value => Number.isFinite(value) && value > 0)
            && minBPM < maxBPM
            && [interval, scanSteps, scanSamples].every(value => Number.isSafeInteger(value) && value > 0),
            "Invalid BPM scan options")
        const slow = (sampleRate / (minBPM / 60.0)) / interval
        const fast = (sampleRate / (maxBPM / 60.0)) / interval
        const step = (slow - fast) / scanSteps
        // Require a full-ULP step so round-to-even ties cannot stall inside the scan.
        assert(Number.isFinite(slow) && Number.isFinite(step) && fast > 0 && slow + step / 2 > slow,
            "Invalid BPM scan options: unrepresentable interval")
        const env = new Float32Array(Math.floor(buf.length / interval))
        let v = 0.0, k = 0.0, i = 0
        for (const x of buf) {
            const z = Math.abs(x)
            v += (z - v) * (z > v ? 1 / 8 : 1 / 512)
            if (++k === interval) {
                k = 0
                env[i++] = v
            }
        }
        if (!env.length) return NaN
        console.time("bpm detection")
        const sample = (frames: Float32Array, index: int) => frames[Math.floor(index)] ?? 0.0
        const ivToBpm = (iv: number) => (sampleRate / (iv * interval)) * 60.0
        const BEATS = [-32, -16, -8, -4, -2, -1, 1, 2, 4, 8, 16, 32] as const
        const NO_BEATS = [-0.5, -0.25, 0.25, 0.5] as const
        const autodiff = (iv: number) => {
            const mid = Math.random() * env.length
            const v0 = sample(env, mid)
            let d = 0, t = 0
            for (const b of BEATS) {
                const w = 1 / Math.abs(b)
                d += w * Math.abs(sample(env, mid + b * iv) - v0)
                t += w
            }
            for (const nb of NO_BEATS) {
                const w = Math.abs(nb)
                d -= w * Math.abs(sample(env, mid + nb * iv) - v0)
                t += w
            }
            return d / t
        }
        const avgDiff = (iv: number) => {
            let s = 0.0
            for (let i = 0; i < scanSamples; ++i) s += autodiff(iv)
            return s / scanSamples
        }
        let bestBpm = minBPM, bestScore = Infinity
        for (let iv = fast; iv <= slow; iv += step) {
            const bpm = ivToBpm(iv)
            const cost = avgDiff(iv) * (minBPM / bpm)
            if (cost < bestScore) {
                bestScore = cost
                bestBpm = bpm
            }
        }
        console.timeEnd("bpm detection")
        return bestBpm
    }
}