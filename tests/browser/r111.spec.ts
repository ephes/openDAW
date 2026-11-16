import {expect, test} from "@playwright/test"

test.beforeEach(async ({page}) => {await page.goto("/")})
test("device cut and refused output paste retain graph ownership", async ({page}) => {
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the browser fixture as a module.
        return (await import("/r111-ownership.ts")).clipboardOwnership()
    })
    expect(result).toEqual({cutPreserved: true, refused: true, restored: true})
})
test("project Stop cancels pending recording acquisition", async ({page}) => {
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the browser fixture as a module.
        return (await import("/r111-ownership.ts")).recordingCancellation()
    })
    expect(result).toEqual({retired: 1, captures: 0, transports: 0, available: true})
})
test("overlapping monitor choices retain the latest synthetic WebAudio stream", async ({page}) => {
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the browser fixture as a module.
        return (await import("/r111-ownership.ts")).monitorOwnership()
    })
    expect(result).toEqual({latest: "synthetic-new", oldRetired: true, currentInstalled: true})
})
