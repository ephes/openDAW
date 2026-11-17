import {expect, test} from "vitest"
import {Delay} from "./delay"

test.each([false, true])("retargeting to the current slew position cancels movement (split=%s)", split => {
    const moving = new Delay(256, 10), stationary = new Delay(256, 10)
    stationary.offset = 5
    const source = Float32Array.from({length: 128}, (_, i) => i + 1)
    const actual = new Float32Array(128), expected = new Float32Array(128)
    moving.process(actual, source, 0, 32)
    stationary.process(expected, source, 0, 32)
    moving.offset = 10
    moving.process(actual, source, 32, 37) // Instantaneous offset is now exactly 5.
    stationary.process(expected, source, 32, 37)
    moving.offset = 5
    for (const [from, to] of split ? [[37, 38], [38, 41], [41, 77], [77, 128]] : [[37, 128]]) {
        moving.process(actual, source, from, to)
        stationary.process(expected, source, from, to)
    }
    expect(actual.slice(37)).toEqual(expected.slice(37))
    // Ordinary retargeting still starts from the cancelled position.
    moving.offset = stationary.offset = 8.5
    moving.process(actual, source, 0, 128)
    stationary.process(expected, source, 0, 128)
    expect(actual).toEqual(expected)
})
