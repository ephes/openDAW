import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {reportRoomDuration, startRoomDurationHeartbeat} from "./RoomStatsReporter"
let now = 0
const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response())
const amounts = () => fetchMock.mock.calls.map(call => JSON.parse((call[1] as RequestInit).body as string).durationMinutes)
beforeEach(() => {
    now = 0; vi.useFakeTimers()
    vi.spyOn(performance, "now").mockImplementation(() => now)
    vi.stubGlobal("navigator", {})
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear()
})
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
describe("elapsed room duration", () => {
    it("accounts for a delayed ten minute callback", () => {
        const heartbeat = startRoomDurationHeartbeat("synthetic")
        now = 600_000; vi.advanceTimersByTime(60_000)
        expect(amounts()).toEqual([10])
        heartbeat.finalize(); heartbeat.finalize()
        expect(amounts()).toEqual([10])
    })
    it.each([[89_999, [1]], [90_000, [1, 1]], [120_000, [1, 1]]])("carries the tail and rounds only at finalization (%s)", (end, expected) => {
        const heartbeat = startRoomDurationHeartbeat("synthetic")
        now = 61_000; vi.advanceTimersByTime(60_000)
        now = end; heartbeat.finalize(); heartbeat.finalize()
        expect(amounts()).toEqual(expected)
    })
    it("ignores wall clock jumps and fenced interval callbacks", () => {
        const heartbeat = startRoomDurationHeartbeat("synthetic")
        vi.setSystemTime(new Date("2000-01-01"))
        now = 120_000; heartbeat.finalize()
        vi.advanceTimersByTime(600_000)
        expect(amounts()).toEqual([2])
    })
})

describe("room suspension", () => {
    it("excludes time away and carries fractions across repeated restores", () => {
        const heartbeat = startRoomDurationHeartbeat("synthetic")
        now = 20_000; heartbeat.pause(); heartbeat.pause()
        now = 600_000; vi.advanceTimersByTime(60_000)
        expect(amounts()).toEqual([])
        heartbeat.resume(); heartbeat.resume()
        now = 620_000; heartbeat.pause()
        now = 900_000; heartbeat.resume()
        now = 920_000; vi.advanceTimersByTime(60_000)
        expect(amounts()).toEqual([1])
        heartbeat.finalize(); heartbeat.resume()
        now = 1_000_000; vi.advanceTimersByTime(60_000)
        expect(amounts()).toEqual([1])
    })
    it("rounds a suspended tail once without adding absence", () => {
        const heartbeat = startRoomDurationHeartbeat("synthetic")
        now = 30_000; heartbeat.pause()
        now = 900_000; heartbeat.finalize(); heartbeat.finalize()
        expect(amounts()).toEqual([1])
    })
})

describe("duration transport", () => {
    it.each(["accepted", "refused", "throws", "absent"])("handles beacon %s once", mode => {
        const beacon = vi.fn(() => {
            if (mode === "throws") {throw new Error("unavailable")}
            return mode === "accepted"
        })
        vi.stubGlobal("navigator", mode === "absent" ? {} : {sendBeacon: beacon})
        reportRoomDuration("synthetic", 3)
        expect(beacon).toHaveBeenCalledTimes(mode === "absent" ? 0 : 1)
        expect(fetchMock).toHaveBeenCalledTimes(mode === "accepted" ? 0 : 1)
        if (mode !== "accepted") {
            expect(amounts()).toEqual([3])
            expect(fetchMock.mock.calls[0][1]?.keepalive).toBe(true)
        }
    })
})
