import {expect, it} from "vitest"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {PolyphonicStrategy} from "./PolyphonicStrategy"
import {block, host, note} from "./test-fixtures"
it("retires simultaneous voices, isolates stops, glides from released voices and resets", () => {
    const f = host(), s = new PolyphonicStrategy(f.host), a = note(60), b = note(64)
    s.start(a); s.start(b); s.stop(a.id)
    expect(f.voices.map(v => v.gate)).toEqual([false, true])
    s.start(note(67)); expect(f.voices[2].calls.slice(0, 2)).toEqual([["start", f.voices[2].id, 600, 1, 0], ["glide", 670, 2]])
    const out = new AudioBuffer(); out.channels().forEach(ch => ch.fill(9))
    expect(s.process(out, block, 3, 7)).toBe(false)
    expect(Array.from(out.getChannel(0).slice(2, 8))).toEqual([9, 3, 3, 3, 3, 9])
    f.voices.forEach(v => v.done = true)
    expect(s.process(out, block, 3, 7)).toBe(true)
    s.start(note(70)); expect(f.voices[3].calls).toEqual([["start", f.voices[3].id, 700, 1, 0]])
    s.reset(); s.start(note(72))
    expect(f.voices[4].calls).toEqual([["start", f.voices[4].id, 720, 1, 0]])
    expect(s.processing()).toEqual([f.voices[4]])
})
