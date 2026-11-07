import {expect, it} from "vitest"
import {Pulse} from "./PulseOsc"
it("matches an analytical one-harmonic pulse including duty extremes and Nyquist cap", () => {
    for (const width of [0, 0.25, 0.5, 1]) {
        const p = new Pulse(1000); p.setFrequency(400); p.setPulseWidth(width)
        for (let i = 1; i <= 20; i++) {
            const phase = (i * 0.4) % 1
            const expected = (Math.sin(-2 * Math.PI * phase) + Math.sin(2 * Math.PI * (phase + width)) + (2 * width - 1) * 1.56) * 2 / Math.PI
            expect(p.tick()).toBeCloseTo(expected, 10)
        }
    }
    const capped = new Pulse(1000), nyquist = new Pulse(1000)
    capped.setFrequency(900); nyquist.setFrequency(500)
    for (let i = 0; i < 20; i++) expect(capped.tick()).toBe(nyquist.tick())
})
it.each([8000, 44100, 48000])("updates frequency without reset and replays deterministically at %s Hz", rate => {
    const p = new Pulse(rate); p.setFrequency(rate / 8)
    Array.from({length: 8}, () => p.tick())
    p.setFrequency(rate * 0.4)
    const q = new Pulse(rate); q.setFrequency(rate * 0.4)
    for (let i = 0; i < 20; i++) expect(p.tick()).toBeCloseTo(q.tick(), 10)
    p.reset(); const first = Array.from({length: 200}, () => p.tick())
    p.reset(); expect(Array.from({length: 200}, () => p.tick())).toEqual(first)
    expect(first.every(Number.isFinite)).toBe(true)
})
it("holds the analytical DC value at zero frequency after a running oscillator", () => {
    for (const width of [0, 0.25, 0.5, 1]) {
        const p = new Pulse(1000); p.setFrequency(100); p.setPulseWidth(width)
        for (let i = 0; i < 7; i++) p.tick()
        p.setFrequency(0)
        for (let i = 0; i < 20; i++) expect(p.tick()).toBeCloseTo((2 * width - 1) * 1.56 * 2 / Math.PI, 12)
    }
})
it.each([[-0.5, 0], [1.5, 1]])("clamps duty width %s to %s", (input, bounded) => {
    const p = new Pulse(1000), reference = new Pulse(1000)
    p.setFrequency(400); reference.setFrequency(400)
    p.setPulseWidth(input); reference.setPulseWidth(bounded)
    for (let i = 0; i < 32; i++) expect(p.tick()).toBe(reference.tick())
})
