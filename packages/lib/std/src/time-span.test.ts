import {afterEach, describe, expect, it, vi} from "vitest"
import {TimeSpan} from "./time-span"

afterEach(() => vi.restoreAllMocks())
describe("TimeSpan estimates and units", () => {
    it("estimates remaining duration from a controlled elapsed clock", () => {
        const clock = vi.spyOn(performance, "now").mockReturnValue(100)
        const estimate = TimeSpan.createEstimator()
        expect(estimate(0)).toBe(TimeSpan.POSITIVE_INFINITY)
        clock.mockReturnValue(1100)
        expect(estimate(0.25).millis()).toBe(3000)
        clock.mockReturnValue(2100)
        expect(estimate(0.5).millis()).toBe(2000)
        expect(estimate(1).millis()).toBe(0)
        expect(estimate(2).isNow()).toBe(true)
    })
    it("converts units and retains negative/past semantics", () => {
        expect(TimeSpan.seconds(1.5).millis()).toBe(1500)
        expect(TimeSpan.minutes(2).millis()).toBe(120000)
        expect(TimeSpan.hours(2).millis()).toBe(7200000)
        expect(TimeSpan.days(2).millis()).toBe(172800000)
        const past = TimeSpan.hours(-24)
        expect(past.absSeconds()).toBe(86400)
        expect(past.absMinutes()).toBe(1440)
        expect(past.absHours()).toBe(24)
        expect(past.absDays()).toBe(1)
        expect(past.isPast()).toBe(true)
        expect(past.isFuture()).toBe(false)
        expect(past.toString()).toBe("1 day, 0 hour, 0 minute, 0 second")
        expect(TimeSpan.seconds(-2).toUnitString()).toBe("2 seconds ago")
        expect(TimeSpan.seconds(2).toUnitString()).toBe("in 2 seconds")
        expect(TimeSpan.millis(0).isNow()).toBe(true)
    })
    it.each([
        [59, {d: 0, h: 0, m: 0, s: 59}, "00:00:59"],
        [60, {d: 0, h: 0, m: 1, s: 0}, "00:01:00"],
        [3599, {d: 0, h: 0, m: 59, s: 59}, "00:59:59"],
        [3600, {d: 0, h: 1, m: 0, s: 0}, "01:00:00"],
        [86399, {d: 0, h: 23, m: 59, s: 59}, "23:59:59"],
        [86400, {d: 1, h: 0, m: 0, s: 0}, "24:00:00"]
    ] as const)("carries unit boundaries at %s seconds", (seconds, split, clock) => {
        expect(TimeSpan.seconds(seconds).split()).toEqual(split)
        expect(TimeSpan.toHHMMSS(seconds)).toBe(clock)
    })
    it("formats finite and nonfinite spans explicitly", () => {
        expect(TimeSpan.seconds(59).toString()).toBe("59 seconds")
        expect(TimeSpan.seconds(60).toString()).toBe("1 minute, 0 second")
        expect(TimeSpan.millis(0).toString()).toBe("now")
        expect(TimeSpan.millis(NaN).toString()).toBe("NaN")
        for (const value of [Infinity, -Infinity]) {expect(TimeSpan.millis(value).toString()).toBe("∞")}
        for (const value of [NaN, Infinity, -Infinity]) {expect(() => TimeSpan.millis(value).toUnitString()).toThrow(RangeError)}
    })
})
