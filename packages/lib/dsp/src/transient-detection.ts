import {AudioData} from "./audio-data"
import {BiquadCoeff} from "./biquad-coeff"
import {BiquadMono} from "./biquad-processor"
import {panic} from "@opendaw/lib-std"
import {centeredEnergyEnvelope, transientValley} from "./transient-energy"

const LR_ORDER = 48
const LOW_CROSSOVER_HZ = 200.0
const HIGH_CROSSOVER_HZ = 2000.0
const RMS_WINDOW_MS = 20.0
const MIN_TRANSIENT_COUNT = 2
const ENERGY_DERIVATIVE_THRESHOLD = 0.0003
const MAX_TRANSIENT_DENSITY_PER_SEC = 40.0
const MIN_TRANSIENT_SEPARATION_MS = 120.0
const VALLEY_BIAS = 0.2
const MAX_VALLEY_SEARCH_MS = 20.0
const VALLEY_RMS = 0.006

const BAND_WEIGHTS: Record<Band, number> = {
    low: 1.0,
    mid: 4.0,
    high: 8.0
}

type Band = "low" | "mid" | "high"

type BandBuffers = {
    low: Float32Array
    mid: Float32Array
    high: Float32Array
}

type Onset = {
    position: number
    energy: number
}

export class TransientDetector {
    static detect(audio: AudioData): number[] {
        const now = performance.now()
        const duration = audio.numberOfFrames / audio.sampleRate
        const result = new TransientDetector(audio).#detect()
        const took = (((performance.now() - now) / 1000.0) / duration * 100.0).toFixed(2)
        console.debug(`realtime factor: ${took}%`)
        return result
    }

    readonly #sampleRate: number
    readonly #numberOfFrames: number
    readonly #maxValleySearchSamples: number
    readonly #minSeparationSamples: number
    readonly #windowSamples: number
    readonly #maxCount: number
    readonly #mono: Float32Array

    constructor(audio: AudioData) {
        this.#sampleRate = audio.sampleRate
        this.#numberOfFrames = audio.numberOfFrames
        this.#maxValleySearchSamples = Math.floor((MAX_VALLEY_SEARCH_MS / 1000.0) * this.#sampleRate)
        this.#minSeparationSamples = Math.floor((MIN_TRANSIENT_SEPARATION_MS / 1000.0) * this.#sampleRate)
        this.#windowSamples = Math.floor((RMS_WINDOW_MS / 1000.0) * this.#sampleRate)
        const durationSeconds = this.#numberOfFrames / this.#sampleRate
        this.#maxCount = Math.floor(durationSeconds * MAX_TRANSIENT_DENSITY_PER_SEC)
        this.#mono = this.#mixToMono(audio)
    }

    #detect(): number[] {
        // Phase 1: Collect rough candidates from all bands
        const candidates = this.#collectCandidates()
        // Phase 2: Refine each candidate to the valley between it and previous
        const refined = this.#refineToValleys(candidates)
        // Strict-increasing invariant. Degenerate inputs (zero-length audio
        // → candidates = [0, 0]) or valley searches that don't advance can
        // produce equal samples; the downstream EventCollection panics on
        // equal positions, so we collapse duplicates here at the source.
        const seconds = refined.map(x => x / this.#sampleRate)
        return seconds.filter((value, index) => index === 0 || value > seconds[index - 1])
    }

    #collectCandidates(): number[] {
        const bands = this.#splitBands()
        const allOnsets: Onset[] = []
        for (const band of ["low", "mid", "high"] as Band[]) {
            const buffer = bands[band]
            const envelope = this.#computeEnergyEnvelope(buffer)
            const onsets = this.#detectOnsets(envelope)
            const weight = BAND_WEIGHTS[band]
            for (const onset of onsets) {
                allOnsets.push({position: onset.position, energy: onset.energy * weight})
            }
        }
        // Sort by energy descending and greedily collect respecting minimum separation
        const collected: number[] = [0, this.#numberOfFrames]
        const sorted = [...allOnsets].sort((a, b) => b.energy - a.energy)
        for (const onset of sorted) {
            if (collected.length >= this.#maxCount + 2 && collected.length >= MIN_TRANSIENT_COUNT + 2) {
                break
            }
            if (!this.#isTooClose(collected, onset.position)) {
                this.#insertSorted(collected, onset.position)
            }
        }
        return collected
    }

    #refineToValleys(candidates: number[]): number[] {
        if (candidates.length < 2) {return candidates}
        const refined: number[] = [candidates[0]]
        const rmsWindow = Math.floor(this.#sampleRate * VALLEY_RMS)
        for (let i = 1; i < candidates.length - 1; i++) {
            const prev = candidates[i - 1]
            const curr = candidates[i]
            if (prev === 0) {
                refined.push(curr)
                continue
            }
            const gap = curr - prev
            const gapBasedStart = prev + Math.floor(gap * VALLEY_BIAS)
            const windowBasedStart = curr - this.#maxValleySearchSamples
            const searchStart = Math.max(gapBasedStart, windowBasedStart)
            refined.push(transientValley(this.#mono, curr, searchStart, rmsWindow))
        }
        refined.push(candidates[candidates.length - 1])
        return refined
    }

    #mixToMono(audio: AudioData): Float32Array {
        const {numberOfFrames, numberOfChannels, frames} = audio
        if (numberOfChannels === 0) {return panic("Invalid sample. No channels found.")}
        if (numberOfChannels === 1) {return new Float32Array(frames[0])}
        const mono = new Float32Array(numberOfFrames)
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const channel = frames[ch]
            for (let i = 0; i < numberOfFrames; i++) {
                mono[i] += channel[i]
            }
        }
        const scale = 1.0 / numberOfChannels
        for (let i = 0; i < numberOfFrames; i++) {
            mono[i] *= scale
        }
        return mono
    }

    #applyLRFilter(input: Float32Array, freq: number, type: "lowpass" | "highpass", order: number): Float32Array {
        const passes = order / 12
        const coeff = new BiquadCoeff()
        const cutoff = freq / this.#sampleRate
        if (type === "lowpass") {
            coeff.setLowpassParams(cutoff, Math.SQRT1_2)
        } else {
            coeff.setHighpassParams(cutoff, Math.SQRT1_2)
        }
        let result = input
        for (let p = 0; p < passes; p++) {
            const filter1 = new BiquadMono()
            const filter2 = new BiquadMono()
            const temp1 = new Float32Array(result.length)
            const temp2 = new Float32Array(result.length)
            filter1.process(coeff, result, temp1, 0, result.length)
            filter2.process(coeff, temp1, temp2, 0, result.length)
            result = temp2
        }
        return result
    }

    #splitBands(): BandBuffers {
        const low = this.#applyLRFilter(this.#mono, LOW_CROSSOVER_HZ, "lowpass", LR_ORDER)
        const highFromLow = this.#applyLRFilter(this.#mono, LOW_CROSSOVER_HZ, "highpass", LR_ORDER)
        const mid = this.#applyLRFilter(highFromLow, HIGH_CROSSOVER_HZ, "lowpass", LR_ORDER)
        const high = this.#applyLRFilter(highFromLow, HIGH_CROSSOVER_HZ, "highpass", LR_ORDER)
        return {low, mid, high}
    }

    #computeEnergyEnvelope(buffer: Float32Array): Float32Array {
        return centeredEnergyEnvelope(buffer, this.#windowSamples)
    }

    #detectOnsets(envelope: Float32Array): Onset[] {
        let maxEnergy = 0.0
        for (let i = 0; i < envelope.length; i++) {
            if (envelope[i] > maxEnergy) {maxEnergy = envelope[i]}
        }
        const threshold = maxEnergy * ENERGY_DERIVATIVE_THRESHOLD
        const onsets: Onset[] = []
        for (let i = 1; i < envelope.length - 1; i++) {
            const derivative = envelope[i] - envelope[i - 1]
            const nextDerivative = envelope[i + 1] - envelope[i]
            if (derivative > threshold && derivative > nextDerivative) {
                onsets.push({position: i, energy: envelope[i]})
            }
        }
        return onsets
    }

    #isTooClose(arr: number[], position: number): boolean {
        const idx = this.#binarySearchInsertPosition(arr, position)
        if (idx > 0 && position - arr[idx - 1] < this.#minSeparationSamples) {
            return true
        }
        return idx < arr.length && arr[idx] - position < this.#minSeparationSamples
    }

    #insertSorted(arr: number[], value: number): void {
        const idx = this.#binarySearchInsertPosition(arr, value)
        arr.splice(idx, 0, value)
    }

    #binarySearchInsertPosition(arr: number[], value: number): number {
        let lo = 0
        let hi = arr.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (arr[mid] < value) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }
        return lo
    }
}
