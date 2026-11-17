import {PPQN} from "@opendaw/lib-dsp"
import {assert} from "@opendaw/lib-std"

// Native tempo events store positive, finite float32 BPM, independent of display bounds.
export const requireTempoBpm = (value: number): void => {
    assert(Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0,
        "Unsupported tempo BPM: expected positive finite native BPM")
}

export const beatTimeToPulses = (time: number): number => {
    const pulses = time * PPQN.Quarter
    assert(Number.isFinite(time) && time >= 0 && Number.isInteger(pulses) && pulses <= 0x7fffffff,
        "Unsupported timeline coordinate: time must fit nonnegative native integer pulses")
    return pulses
}
