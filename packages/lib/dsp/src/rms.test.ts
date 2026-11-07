import {expect, it} from "vitest"
import {RMS} from "./rms"
it("matches a finite FIFO energy oracle across scalar/block calls, wraps and clears", () => {
    const rms = new RMS(8), fifo = Array(8).fill(0)
    const oracle = (x: number) => {fifo.shift(); fifo.push(x); return Math.sqrt(fifo.reduce((sum, v) => sum + v * v, 0) / 8)}
    const values = new Float32Array([1, ...Array(10).fill(0), ...Array(16).fill(0.3), ...Array.from({length: 80}, (_, i) => (i % 2 ? -1 : 1) * ((i * 37 % 101) / 100))])
    let i = 0
    while (i < values.length) {
        if (i % 3 === 0) {expect(rms.pushPop(values[i])).toBeCloseTo(oracle(values[i]), 6); i++}
        else {
            const count = Math.min(5, values.length - i), selected = new Float32Array([99, ...values.slice(i, i + count), 99])
            let expected = 0
            for (let j = 0; j < count; j++) expected = oracle(values[i + j])
            expect(rms.processBlock(selected, 1, count + 1)).toBeCloseTo(expected, 6); i += count
        }
    }
    rms.clear(); rms.clear()
    const fresh = new RMS(8)
    for (const value of [0, 1, -1, 0.5, 0]) expect(rms.pushPop(value)).toBe(fresh.pushPop(value))
})
