import {expect, test} from "@playwright/test"

test.beforeEach(async ({page}) => {await page.goto("/")})

for (const finish of ["cancel", "escape", "dispose", "approve", "external", "insert"] as const) {
    test(`warp drag owns preview, cancellation and history: ${finish}`, async ({page}) => {
        await page.evaluate(async () => {
            // @ts-expect-error Vite serves this synthetic fixture module.
            const module = await import("/r114-gestures.ts")
            Object.assign(window, {warp: module.setupWarp()})
        })
        const read = () => page.evaluate(() => (window as unknown as {warp: {read(): unknown}}).warp.read())
        const call = (method: string) => page.evaluate(method => {
            (window as unknown as {warp: Record<string, () => unknown>}).warp[method]()
        }, method)
        await page.mouse.move(250, 30)
        await page.mouse.down()
        await page.mouse.move(400, 30)
        expect(await read()).toEqual({position: 1000, preview: 1600, undo: true})
        if (finish === "cancel") {
            await page.locator("#gesture").dispatchEvent("pointercancel", {pointerId: 1})
        } else if (finish === "escape") {await page.keyboard.press("Escape")}
        else if (finish === "dispose") {await call("dispose")}
        else if (finish === "external") {await call("external")}
        else if (finish === "insert") {await call("insert")}
        await page.mouse.up()
        const position = finish === "approve" ? 1600 : finish === "external" ? 1100 : finish === "insert" ? 1260 : 1000
        expect(await read()).toEqual({position, preview: null, undo: true})
        if (["approve", "cancel", "escape", "dispose"].includes(finish)) {
            await call("undo")
            expect(await read()).toEqual({position: 1000, preview: null, undo: finish === "approve"})
            if (finish === "approve") {
                await call("undo")
                expect(await read()).toEqual({position: 1000, preview: null, undo: false})
            }
        }
        await call("close")
    })
}

test("note ownership, pitch spans and slope generations work with real graph edits", async ({page}) => {
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves this synthetic fixture module.
        return (await import("/r114-gestures.ts")).noteAndSlope()
    })
    expect(result).toEqual({preview: [0, 4, 90], committed: [0, 4, 90], restored: [2, 6, 90], audition: [0],
        oneMotion: true, preserved: true, segmentPreserved: true, contentCount: 3, linear: "linear"})
})
