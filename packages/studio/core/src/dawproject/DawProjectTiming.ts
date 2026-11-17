import {assert} from "@opendaw/lib-std"

// Native tempo events store positive, finite float32 BPM, independent of display bounds.
export const requireTempoBpm = (value: number): void => {
    assert(Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0,
        "Unsupported tempo BPM: expected positive finite native BPM")
}
