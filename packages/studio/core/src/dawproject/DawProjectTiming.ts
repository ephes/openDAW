import {PPQN} from "@opendaw/lib-dsp"
import {assert} from "@opendaw/lib-std"

// Native tempo events store positive, finite float32 BPM, independent of display bounds.
export const requireTempoBpm = (value: number): void => {
    assert(Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0,
        "Unsupported tempo BPM: expected positive finite native BPM")
}

export const beatTimeToPulses = (time: number): number => {
    const scaled = time * PPQN.Quarter
    const pulses = Math.round(scaled)
    // Native integer / PPQN / XML number / PPQN may differ by a couple of ulps.
    // A relative tolerance still refuses tiny positive sub-pulse times near zero.
    const roundoff = Number.EPSILON * Math.abs(scaled) * 2
    assert(Number.isFinite(time) && time >= 0 && pulses <= 0x7fffffff
        && Math.abs(scaled - pulses) <= roundoff,
        "Unsupported timeline coordinate: time must fit nonnegative native integer pulses")
    return pulses
}
