import {describe, expect, it} from "vitest"
import {z} from "zod"

describe("patched Zod collection bounds", () => {
    it("rejects an oversized invalid collection with one size issue", () => {
        const result = z.array(z.object({name: z.string()})).max(2).safeParse([null, null, null, null])
        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.error.issues).toHaveLength(1)
            expect(result.error.issues[0].code).toBe("too_big")
        }
    })
})
