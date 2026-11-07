import {expect, it} from "vitest"
import {AudioBuffer} from "../AudioBuffer"
import {DelayLine} from "./DelayLine"
it.each([0, 0.035])("matches independent stereo FIFO over subranges and ring wraps (delay=%s)", seconds => {
    const delay = new DelayLine(100, seconds, 128, 2), count = Math.floor(100 * seconds)
    const queues = [Array(count).fill(0), Array(count).fill(0)]
    let position = 0
    for (const size of [7, 128, 3, 99, 1, 71, 128]) {
        const from = size === 128 ? 0 : 4, to = from + size, b = new AudioBuffer()
        b.channels().forEach((ch, c) => {ch.fill(99); for (let i = from; i < to; i++) ch[i] = (position + i - from + 1) * (c ? -2 : 1)})
        const expected = b.channels().map((ch, c) => {
            const out = ch.slice()
            for (let i = from; i < to; i++) {queues[c].push(ch[i]); out[i] = queues[c].shift()!}
            return out
        })
        delay.process(b, from, to); b.channels().forEach((ch, c) => expect(ch).toEqual(expected[c]))
        position += size
    }
})
