import {expect, it} from "vitest"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Voicing} from "./Voicing"
import {PolyphonicStrategy} from "./PolyphonicStrategy"
import {MonophonicStrategy} from "./MonophonicStrategy"
import {block, host, note} from "./test-fixtures"
it("sums current and multiple expiring strategies and retires finished tails", () => {
    const f = host(), first = new PolyphonicStrategy(f.host), v = new Voicing(first)
    v.start(note(60)); f.voices[0].amplitude = 2
    v.strategy = new MonophonicStrategy(f.host); v.start(note(64)); f.voices[1].amplitude = 3
    v.strategy = new PolyphonicStrategy(f.host); v.start(note(67))
    const out = new AudioBuffer(); out.channels().forEach(ch => ch.fill(9))
    v.process(out, block, 2, 5)
    expect(Array.from(out.getChannel(0).slice(1, 6))).toEqual([9, 6, 6, 6, 9])
    f.voices[0].done = true; f.voices[1].done = true
    v.process(out, block, 2, 5); v.process(out, block, 2, 5)
    expect(Array.from(out.getChannel(0).slice(1, 6))).toEqual([9, 1, 1, 1, 9])
    expect(f.voices[0].calls.filter(c => c[0] === "process")).toHaveLength(2)
    v.reset(); v.process(out, block, 2, 5)
    expect(out.getChannel(0)[2]).toBe(0)
})
it("initializes from the default strategy without retaining a nonexistent tail", () => {
    const f = host(), v = new Voicing(), out = new AudioBuffer()
    v.strategy = new PolyphonicStrategy(f.host); v.start(note(60))
    v.process(out, block, 0, 4)
    expect(Array.from(out.getChannel(0).slice(0, 4))).toEqual([1, 1, 1, 1])
})
