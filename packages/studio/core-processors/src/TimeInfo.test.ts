import {expect, it} from "vitest"
import {TimeInfo} from "./TimeInfo"
it("consumes seeks once, advances without a leap, and pauses recording/count-in", () => {
    const time = new TimeInfo()
    expect(time.getLeapStateAndReset()).toBe(false)
    time.position = 123
    expect(time.getLeapStateAndReset()).toBe(true)
    expect(time.getLeapStateAndReset()).toBe(false)
    time.advanceTo(456)
    expect(time.getLeapStateAndReset()).toBe(false)
    time.transporting = true; time.transporting = true; time.transporting = false
    expect(time.position).toBe(456)
    time.transporting = true; time.isRecording = true; time.isCountingIn = true; time.metronomeEnabled = true
    time.pause(); time.pause()
    expect([time.transporting, time.isRecording, time.isCountingIn, time.metronomeEnabled, time.position])
        .toEqual([false, false, false, true, 456])
})
