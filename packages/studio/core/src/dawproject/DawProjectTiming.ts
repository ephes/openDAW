import {PPQN} from "@opendaw/lib-dsp"
import {assert} from "@opendaw/lib-std"

// Native tempo events store positive, finite float32 BPM, independent of display bounds.
export const requireTempoBpm = (value: number): void => {
    assert(Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0,
        "Unsupported tempo BPM: expected positive finite native BPM")
}

// Half a unit in the sixth decimal of a beat, plus slack for binary rounding.
const DECIMAL_BEAT_PRECISION = 0.5e-6 * (1 + 1e-6)

export const beatTimeToPulses = (time: number): number => {
    const scaled = time * PPQN.Quarter
    const pulses = Math.round(scaled)
    // Native integer / PPQN / XML number / PPQN may differ by a couple of ulps, and
    // DAWs such as Bitwig write beat times with six fixed decimals (a triplet pulse
    // becomes "0.333333"). Admit both within half a microbeat of a pulse. Real
    // sub-pulse offsets ("0.0001") and positive times collapsing to zero are refused.
    const tolerance = Math.max(Number.EPSILON * Math.abs(scaled) * 2, DECIMAL_BEAT_PRECISION * PPQN.Quarter)
    assert(Number.isFinite(time) && time >= 0 && pulses <= 0x7fffffff
        && Math.abs(scaled - pulses) <= tolerance && (pulses > 0 || time === 0),
        "Unsupported timeline coordinate: time must fit nonnegative native integer pulses")
    return pulses
}
