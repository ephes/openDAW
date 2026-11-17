import {expect, it} from "vitest"
import {Peaks} from "./Peaks"

it.each([[0x3800, 0.5], [0x3c00, 1], [0x4000, 2]])("unpacks exact binary16 peak power %s", (bits, expected) => {
    expect(Peaks.unpack(bits | bits << 16, 0)).toBe(expected)
    expect(Peaks.unpack(bits | bits << 16, 1)).toBe(expected)
})
