import {beforeAll, expect, it} from "vitest"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {block, host, note} from "./test-fixtures"
let VoiceUnison: typeof import("./VoiceUnison").VoiceUnison
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); ({VoiceUnison} = await import("./VoiceUnison"))})
it.each([1, 2, 5])("normalizes %s children and retains the last child", n => {
    const f = host(), s = new VoiceUnison(() => f.host.create(), n), event = note(60)
    s.start(event, 600, 0.8, 0.25)
    const gains = f.voices.map(v => v.calls[0][3] as number), spreads = f.voices.map(v => v.calls[0][4] as number)
    expect(gains.reduce((sum, g) => sum + g * g, 0)).toBeCloseTo(0.64, 12)
    expect(spreads.reduce((a, b) => a + b, 0) / n).toBeCloseTo(0.25, 12)
    spreads.forEach((x, i) => {expect(Math.abs(x)).toBeLessThanOrEqual(1); expect(x + spreads[n - i - 1]).toBeCloseTo(0.5, 12)})
    s.startGlide(700, 2); s.stop(); s.forceStop()
    f.voices.forEach(v => expect(v.calls.slice(1)).toEqual([["glide", 700, 2], ["stop"], ["forceStop"]]))
    f.voices.slice(0, -1).forEach(v => v.done = true)
    const out = new AudioBuffer()
    expect(s.process(out, block, 1, 4)).toBe(false)
    f.voices.at(-1)!.done = true
    expect(s.process(out, block, 1, 4)).toBe(true)
})
