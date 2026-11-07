import {beforeAll, expect, it} from "vitest"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {FreeVerb} from "./FreeVerb"
beforeAll(() => {Object.assign(globalThis, {sampleRate: 48000})})
function render(reverb: FreeVerb, impulse: boolean, parts = [128]) {
    const output = [new Float32Array(6000), new Float32Array(6000)]
    let position = 0, part = 0
    while (position < 6000) {
        const count = Math.min(parts[part++ % parts.length], 6000 - position), from = count === 128 ? 0 : 3
        const input = new AudioBuffer(), out = new AudioBuffer(); out.channels().forEach(ch => ch.fill(99))
        if (impulse && position === 0) {input.getChannel(0)[from] = 1; input.getChannel(1)[from] = -0.5}
        reverb.process(out, input, from, from + count)
        if (from > 0) expect(out.getChannel(0)[0]).toBe(99)
        if (from + count < 128) expect(out.getChannel(0)[from + count]).toBe(99)
        out.channels().forEach((ch, c) => output[c].set(ch.subarray(from, from + count), position))
        position += count
    }
    return output
}
it("clears all history, reproduces fresh stereo impulses and ignores block partitioning", () => {
    const warm = new FreeVerb(0.02), fresh = new FreeVerb(0.02)
    const expected = render(fresh, true)
    render(warm, true); warm.clear()
    expect(render(warm, false)).toEqual([new Float32Array(6000), new Float32Array(6000)])
    warm.clear(); expect(render(warm, true, [7, 53, 1, 64])).toEqual(expected)
    expect(expected[0]).not.toEqual(expected[1])
    expect(expected[0].slice(1000).some(x => x !== 0)).toBe(true)
})
it("preserves dry PCM at unity gain with wet disabled", () => {
    const v = new FreeVerb(0.02); v.dryGain = 1; v.wetGain = 0
    const input = new AudioBuffer(), output = new AudioBuffer()
    input.channels().forEach((ch, c) => ch.set(Array.from({length: 128}, (_, i) => (i - 64) * (c ? -0.01 : 0.01))))
    v.process(output, input, 5, 120)
    // Signed zero is equivalent PCM; require exact numeric equality for every sample.
    output.channels().forEach((ch, c) => {
        for (let i = 5; i < 120; i++) expect(ch[i] === input.getChannel(c)[i]).toBe(true)
    })
})
