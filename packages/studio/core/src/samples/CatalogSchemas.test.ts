import {describe, expect, it} from "vitest"
import {z} from "zod"
import {Sample, Soundfont} from "@opendaw/studio-adapters"

const uuid = "00000000-0000-4000-8000-000000000001"
describe("catalog schemas with patched Zod", () => {
    it("preserves valid sample and soundfont collections", () => {
        const sample = {uuid, name: "Synthetic sample", bpm: 120, duration: 1, sample_rate: 48000, origin: "openDAW"}
        const soundfont = {uuid, name: "Synthetic soundfont", size: 4, url: "https://example.invalid/font",
            license: "Synthetic", origin: "openDAW"}
        expect(z.array(Sample).parse([sample])).toEqual([sample])
        expect(z.array(Soundfont).parse([soundfont])).toEqual([soundfont])
    })
    it.each([Sample, Soundfont])("rejects invalid catalog entries", schema => {
        expect(z.array(schema).safeParse([{uuid: "invalid"}]).success).toBe(false)
    })
})
