import {expect, it} from "vitest"
import {centeredEnergyEnvelope, transientValley} from "./transient-energy"

it.each([1, 2, 3, 4, 7, 8])("matches a clipped centered RMS oracle for window %s", window => {
    for (const values of [[1], [1, 1, 1], [1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 1]]) {
        const buffer = Float32Array.from(values)
        const actual = centeredEnergyEnvelope(buffer, window)
        for (let index = 0; index < buffer.length; index++) {
            const samples = values.slice(Math.max(0, index - Math.floor(window / 2)), index + Math.floor(window / 2) + 1)
            const expected = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
            expect(actual[index]).toBeCloseTo(expected, 6)
        }
    }
})
const reference = (mono: Float32Array, current: number, start: number, window: number): number => {
    const rms = (position: number) => Math.sqrt(Array.from(mono.slice(position, position + window)).reduce((sum, value) => sum + value * value, 0) / window)
    const threshold = rms(current) * 0.66
    let minimum = Infinity, result = current
    for (let position = current - 1; position >= start; position--) {
        const value = rms(position)
        if (value < minimum) {minimum = value; result = position}
        if (value < threshold) {break}
    }
    return result
}
it("preserves backward valley choices including clipped right edges and ties", () => {
    for (const values of [Array(32).fill(1), Array.from({length: 32}, (_, index) => (index % 7) / 8), Array.from({length: 32}, (_, index) => index < 15 ? 0 : 1)]) {
        const mono = Float32Array.from(values)
        for (const current of [10, 20, 30]) {
            expect(transientValley(mono, current, 2, 6)).toBe(reference(mono, current, 2, 6))
        }
    }
})
it.each([48000, 96000])("spends linear sample reads at %s Hz", rate => {
    const mono = new Float32Array(rate).fill(1)
    let reads = 0
    const counted = new Proxy(mono, {get: (target, key) => {
        if (typeof key === "string" && /^\d+$/.test(key)) {reads++}
        return Reflect.get(target, key, target)
    }})
    const search = Math.floor(rate * 0.020), window = Math.floor(rate * 0.006)
    transientValley(counted, rate - 1, rate - 1 - search, window)
    expect(reads).toBeLessThanOrEqual(2 * (window + 2 * search))
})
