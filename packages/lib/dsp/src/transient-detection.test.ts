import {afterEach, describe, expect, it, vi} from "vitest"
import {TransientDetector} from "./transient-detection"
import {AudioData} from "./audio-data"

afterEach(() => vi.restoreAllMocks())
const detect = (audio: AudioData) => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined)
    const markers = TransientDetector.detect(audio)
    markers.forEach((marker, index) => {
        expect(Number.isFinite(marker)).toBe(true)
        expect(marker).toBeGreaterThanOrEqual(0)
        expect(marker).toBeLessThanOrEqual(audio.numberOfFrames / audio.sampleRate)
        if (index > 0) {expect(marker).toBeGreaterThan(markers[index - 1])}
    })
    return markers
}
describe("TransientDetector public markers", () => {
    it.each([0, 1, 7, 512])("keeps empty/tiny/silent %s-frame markers valid", frames => {
        const audio = AudioData.create(8000, frames, 1)
        const markers = detect(audio)
        expect(new Set(markers).size).toBe(markers.length)
        if (frames > 0) {expect(markers).toEqual([0, frames / 8000])}
    })
    it("finds interior burst markers invariant under inversion and duplicated channels", () => {
        const mono = AudioData.create(8000, 8000, 1)
        let seed = 42
        for (const start of [1600, 4000, 6400]) {
            for (let index = start; index < start + 128; index++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) | 0
                mono.frames[0][index] = ((seed >>> 0) / 4294967296) * 2 - 1
            }
        }
        const negative = AudioData.create(8000, 8000, 1)
        const stereo = AudioData.create(8000, 8000, 2)
        negative.frames[0].set(mono.frames[0].map(value => -value))
        stereo.frames.forEach(channel => channel.set(mono.frames[0]))
        const markers = detect(mono)
        expect(markers.filter(marker => marker > 0 && marker < 1).length).toBeGreaterThanOrEqual(2)
        expect(detect(negative)).toEqual(markers)
        expect(detect(stereo)).toEqual(markers)
    })
})
