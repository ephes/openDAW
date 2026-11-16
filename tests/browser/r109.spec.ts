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

for (const kind of ["werkstatt", "spielwerk"] as const) {
    test(`${kind} admits latest installed request and intentional undo in a real worklet`, async ({page}) => {
        await page.goto("/")
        const result = await page.evaluate(async kind => {
            // @ts-expect-error Vite serves the browser fixture as a module.
            const {scriptInstallation} = await import("/r109-shared-fixture.ts")
            return scriptInstallation(kind)
        }, kind)
        expect(result).toEqual({latest: 2, undo: 0})
    })
}
