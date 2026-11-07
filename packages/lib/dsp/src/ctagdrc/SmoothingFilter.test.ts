import {expect, it} from "vitest"
import {SmoothingFilter} from "./SmoothingFilter"
it("uses the input-weight convention for time constants without reinitializing", () => {
    const timed = new SmoothingFilter(100), alpha = new SmoothingFilter(100)
    timed.setAlphaWithTime(1); alpha.setAlpha(1 - Math.exp(-1 / 100))
    timed.process(0); alpha.process(0)
    for (let i = 0; i < 100; i++) {timed.process(1); alpha.process(1); expect(timed.getState()).toBeCloseTo(alpha.getState(), 12)}
    expect(timed.getState()).toBeCloseTo(1 - Math.exp(-1), 12)
    const prev = timed.getState(); timed.setAlphaWithTime(2); timed.process(0)
    expect(timed.getState()).toBeCloseTo(prev * Math.exp(-1 / 200), 12)
    timed.setAlphaWithTime(0); timed.process(0.25); expect(timed.getState()).toBe(0.25)
    const fresh = new SmoothingFilter(100); fresh.setAlphaWithTime(1); fresh.process(4)
    expect(fresh.getState()).toBe(4)
})
