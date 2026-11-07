import {expect, it} from "vitest"
import {LookAhead} from "./LookAhead"
it("anticipates an isolated reduction with a linear ramp across wrap and uneven chunks", () => {
    const signal = new Float32Array(500); signal[150] = -8; signal[350] = -4
    const run = (sizes: number[]) => {
        const look = new LookAhead(1000, 0.008, 128), out: number[] = []
        let position = 0, index = 0
        while (position < signal.length) {
            const count = Math.min(sizes[index++ % sizes.length], signal.length - position)
            const buffer = new Float32Array([99, ...signal.slice(position, position + count), 99])
            look.process(buffer, 1, count + 1)
            expect(buffer[0]).toBe(99); expect(buffer[count + 1]).toBe(99)
            out.push(...buffer.slice(1, count + 1)); position += count
        }
        return out
    }
    const out = run([128]); expect(run([3, 17, 1, 83])).toEqual(out)
    for (let i = 0; i < out.length; i++) {
        let expected = 0
        for (const [position, value] of [[150, -8], [350, -4]]) {
            if (i >= position && i <= position + 8) expected = value * (i - position) / 8
        }
        expect(out[i]).toBeCloseTo(expected, 6)
    }
})
