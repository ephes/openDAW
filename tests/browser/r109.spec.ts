import {expect, test} from "@playwright/test"

test("recording SAB detects worker overflow and preserves admitted blocks", async ({page}) => {
    await page.goto("/")
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the browser fixture as a module.
        const {recordingRing} = await import("/r109-shared-fixture.ts")
        return recordingRing()
    })
    expect(result).toEqual({lost: 1, delivered: 0, seen: [1, 2, 3, 4, 5, 6, 7, 8]})
})
