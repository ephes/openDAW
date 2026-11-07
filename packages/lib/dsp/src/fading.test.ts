import {expect, it} from "vitest"
import {FadingEnvelope as F} from "./fading"
it.each([0, 0.25, 0.5, 0.8, 1])("uses scalar half-open sample times for curved/clipped overlapping fades (%s)", slope => {
    for (const [start, end, duration, fadeIn, fadeOut] of [[0, 4, 8, 4, 0], [1.2, 7.8, 8, 4, 5], [4, 8, 8, 0, 4], [0, 8, 8, 6, 6]]) {
        const config = {in: fadeIn, out: fadeOut, inSlope: slope, outSlope: 1 - slope}
        const whole = new Float32Array(19).fill(99), count = 16
        F.fillGainBuffer(whole, start, end, duration, count, config)
        for (let i = 0; i < count; i++) expect(whole[i]).toBeCloseTo(F.gainAt(start + i * (end - start) / count, duration, config), 6)
        expect(Array.from(whole.slice(count))).toEqual([99, 99, 99])
        const chunks = [new Float32Array(5), new Float32Array(11)]
        const mid = start + (end - start) * 5 / 16
        F.fillGainBuffer(chunks[0], start, mid, duration, 5, config)
        F.fillGainBuffer(chunks[1], mid, end, duration, 11, config)
        expect([...chunks[0], ...chunks[1]]).toEqual(Array.from(whole.slice(0, count)))
    }
})
