import {expect, it} from "vitest"
import {MonophonicStrategy} from "./MonophonicStrategy"
import {host, note} from "./test-fixtures"
it.each([true, false])("last-note priority and final release (release top %s)", top => {
    const f = host(), s = new MonophonicStrategy(f.host), a = note(60), b = note(64)
    s.start(a); s.start(b); s.stop(top ? b.id : a.id)
    expect(f.voices).toHaveLength(1)
    expect(f.voices[0].calls).toEqual([["start", a.id, 600, 1, 0], ["glide", 640, 2], ...(top ? [["glide", 600, 2]] : [])])
    s.stop(top ? a.id : b.id); s.stop(a.id); s.stop(b.id)
    expect(f.voices[0].calls.at(-1)).toEqual(["stop"])
    expect(f.voices[0].calls.filter(c => c[0] === "stop")).toHaveLength(1)
    s.start(note(67)); expect(f.voices[0].calls.at(-1)).toEqual(["forceStop"])
    expect(f.voices[1].calls.slice(0, 2)).toEqual([["start", f.voices[1].id, top ? 600 : 640, 1, 0], ["glide", 670, 2]])
    s.reset(); s.start(note(72)); s.stop(a.id)
    expect(f.voices[2].calls).toEqual([["start", f.voices[2].id, 720, 1, 0]])
})
