import {expect, test} from "@playwright/test"

for (const type of ["note", "value"] as const) {
    for (const retire of [true, false]) {
        test(`${type} editor ${retire ? "retired before connection never steals focus" : "focuses once on first connection"}`, async ({page}) => {
            await page.goto("/")
            await page.evaluate(async ({type, retire}) => {
                const request = window.requestAnimationFrame.bind(window)
                const cancel = window.cancelAnimationFrame.bind(window)
                const pending = new Set<number>()
                window.requestAnimationFrame = callback => {
                    const handle = request(time => {pending.delete(handle); callback(time)})
                    pending.add(handle)
                    return handle
                }
                window.cancelAnimationFrame = handle => {pending.delete(handle); cancel(handle)}
                // @ts-expect-error Vite serves this fixture.
                const editor = (await import("/r126-editors.ts")).setupEditor(type)
                const input = document.createElement("input")
                input.id = "focus-owner"; document.body.append(input); input.focus()
                if (retire) {editor.retire()}
                Object.assign(window, {editor, pendingEditorFrames: pending})
            }, {type, retire})
            if (retire) {
                await expect.poll(() => page.evaluate(() =>
                    (window as unknown as {pendingEditorFrames: Set<number>}).pendingEditorFrames.size)).toBe(0)
            }
            await page.evaluate(() => (window as unknown as {editor: {attach(): void}}).editor.attach())
            if (retire) {
                await page.waitForTimeout(80)
                await expect(page.locator("#focus-owner")).toBeFocused()
            } else {
                await expect(page.locator("#deferred-editor")).toBeFocused()
                await page.locator("#focus-owner").focus()
                await page.waitForTimeout(80)
                await expect(page.locator("#focus-owner")).toBeFocused()
            }
            await page.evaluate(() => (window as unknown as {editor: {close(): void}}).editor.close())
        })
    }
}
