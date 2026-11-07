import {afterEach, describe, expect, it, vi} from "vitest"
import {BPMTools} from "./bpm-tools"

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
describe("BPMTools scan preflight", () => {
    const cases: Array<NonNullable<Parameters<typeof BPMTools.detect>[2]> & {sampleRate?: number}> = [
        {sampleRate: 0}, {sampleRate: -1}, {sampleRate: NaN}, {sampleRate: Infinity},
        {minBPM: 120, maxBPM: 120}, {minBPM: 130, maxBPM: 120},
        {minBPM: 120, maxBPM: 120.00000000000001},
        {sampleRate: 1, interval: 1, minBPM: 60 / 1.1, maxBPM: 60 / 0.9, scanSteps: 2500000000000000},
        {sampleRate: 1, interval: 1, minBPM: 60 / (1.5 + Number.EPSILON), maxBPM: 60 / (1 + Number.EPSILON), scanSteps: 2 ** 52},
        {minBPM: 0}, {minBPM: -1}, {minBPM: NaN}, {maxBPM: Infinity},
        ...["interval", "scanSteps", "scanSamples"].flatMap(key => [0, -1, 1.5, NaN, Infinity, Number.MAX_VALUE].map(value => ({[key]: value})))
    ]
    it.each(cases)("rejects invalid options before allocation: %j", options => {
        const audio = new Float32Array(128)
        const allocations = vi.fn(() => {throw new Error("allocation before validation")})
        vi.stubGlobal("Float32Array", new Proxy(Float32Array, {construct: allocations}))
        vi.spyOn(console, "time").mockImplementation(() => undefined)
        const {sampleRate = 8000, ...scan} = options
        expect(() => BPMTools.detect(audio, sampleRate, scan)).toThrow(/Invalid BPM scan options/)
        expect(allocations).not.toHaveBeenCalled()
    })
    it("estimates a seeded synthetic 120 BPM click track with a small budget", () => {
        let seed = 12345
        vi.spyOn(Math, "random").mockImplementation(() => {
            seed = (Math.imul(seed, 1664525) + 1013904223) | 0
            return (seed >>> 0) / 4294967296
        })
        vi.spyOn(console, "time").mockImplementation(() => undefined)
        vi.spyOn(console, "timeEnd").mockImplementation(() => undefined)
        const audio = new Float32Array(8000 * 6)
        for (let start = 0; start < audio.length; start += 4000) {audio.fill(1, start, start + 32)}
        const bpm = BPMTools.detect(audio, 8000, {interval: 8, scanSteps: 64, scanSamples: 128, minBPM: 100, maxBPM: 140})
        expect(Math.abs(bpm - 120)).toBeLessThan(2)
    })
    it("retains NaN for valid empty audio", () => {
        vi.spyOn(console, "time").mockImplementation(() => undefined)
        expect(BPMTools.detect(new Float32Array(0), 8000)).toBeNaN()
    })
})
