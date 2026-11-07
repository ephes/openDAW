import {expect, it} from "vitest"
import {LevelDetector} from "./LevelDetector"
it("follows independent attack/release one-pole references across uneven partitions", () => {
    const run = (parts: number[]) => {
        const detector = new LevelDetector(100); detector.setAttack(0.1); detector.setRelease(0.5)
        const input = new Float32Array([...Array(15).fill(-12), ...Array(25).fill(0)])
        let from = 0
        for (const count of parts) {detector.applyBallistics(input, from, from + count); from += count}
        return input
    }
    const out = run([40]); expect(run([3, 8, 4, 1, 24])).toEqual(out)
    let state = 0
    for (let i = 0; i < 40; i++) {
        const target = i < 15 ? -12 : 0, a = Math.exp(-1 / (100 * (i < 15 ? 0.1 : 0.5)))
        state = a * state + (1 - a) * target
        expect(out[i]).toBeCloseTo(state, 6)
    }
    const independent = new LevelDetector(100), silent = new Float32Array(40)
    independent.applyBallistics(silent, 0, 40); expect(Array.from(silent)).toEqual(Array(40).fill(0))
})
it("integrates real crest analysis and remains finite on silence and automatic-mode toggles", () => {
    const d = new LevelDetector(1000)
    for (const enabled of [true, false, true]) {
        d.setAutoAttack(enabled); d.setAutoRelease(enabled)
        for (const value of [0, 0.5, 0]) {
            d.processCrestFactor(new Float32Array(20).fill(value), 0, 20)
            const attenuation = new Float32Array(20).fill(-6)
            d.applyBallistics(attenuation, 0, 20)
            expect(Array.from(attenuation).every(x => Number.isFinite(x) && x >= -6 && x <= 0)).toBe(true)
        }
    }
})
