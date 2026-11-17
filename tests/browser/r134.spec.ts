import {expect, test} from "@playwright/test"

type Probe = {actions(): number, state(): {draws: number, width: number, ratio: number, present: boolean, index: number, undo: boolean}, undo(): void, close(): void}
declare global {interface Window {r134: Probe}}
const setup = async (page: import("@playwright/test").Page, kind: "menu" | "canvas" | "panel") => {
    await page.goto("/")
    await page.evaluate(async kind => {
        // @ts-expect-error Vite serves the source fixture.
        window.r134 = (await import("/r134-interactions.ts"))[kind]()
    }, kind)
}

test("context opening and real primary/middle/secondary releases preserve deliberate menu activation", async ({page}) => {
    await setup(page, "menu")
    await page.locator("#menu-source").click({button: "right"})
    const root = page.locator("nav").first()
    await expect(root).toBeVisible()
    await page.waitForTimeout(270)
    const leaf = root.locator(":scope > .container > .item").first()
    await leaf.click({button: "middle"}); await expect(root).toBeVisible()
    await leaf.click({button: "right"}); await expect(root).toBeVisible()
    expect(await page.evaluate(() => window.r134.actions())).toBe(0)
    await leaf.click(); expect(await page.evaluate(() => window.r134.actions())).toBe(1)
    await expect(page.locator("nav")).toHaveCount(0)
    await page.locator("#menu-source").click({button: "right"})
    const submenu = page.locator("nav").first().locator(":scope > .container > .item").nth(1)
    await submenu.hover()
    const child = page.locator("nav nav .item")
    await expect(child).toBeVisible(); await page.waitForTimeout(270)
    await child.click({button: "right"})
    expect(await page.evaluate(() => window.r134.actions())).toBe(1)
    await child.click(); expect(await page.evaluate(() => window.r134.actions())).toBe(2)
    await page.evaluate(() => window.r134.close())
})

test("an idle canvas redraws exactly once when browser density changes", async ({page, context}) => {
    const cdp = await context.newCDPSession(page)
    const density = (factor: number) => cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1000, height: 800, deviceScaleFactor: factor, mobile: false
    })
    await density(1); await setup(page, "canvas")
    await expect.poll(() => page.evaluate(() => window.r134.state().width)).toBe(100)
    // The initial ResizeObserver notification may follow the first RAF draw.
    await page.waitForTimeout(100)
    const baseline = (await page.evaluate(() => window.r134.state())).draws
    await page.waitForTimeout(80)
    expect((await page.evaluate(() => window.r134.state())).draws).toBe(baseline)
    await density(2)
    await expect.poll(() => page.evaluate(() => window.r134.state().width)).toBe(200)
    expect(await page.evaluate(() => window.r134.state())).toMatchObject({draws: baseline + 1, ratio: 2})
    await page.waitForTimeout(80)
    expect((await page.evaluate(() => window.r134.state())).draws).toBe(baseline + 1)
    await page.evaluate(() => window.r134.close())
})

test("panel preserves editable Backspace/Delete and IME while header deletion reindexes with one undo", async ({page}) => {
    await setup(page, "panel")
    const input = page.locator("#effect-number [contenteditable]")
    await input.focus()
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Backspace")
    await expect(input).toHaveText("12")
    await page.keyboard.press("Delete")
    expect(await page.evaluate(() => window.r134.state())).toMatchObject({present: true, index: 1, undo: false})
    const header = page.locator("#effect-header")
    await header.focus()
    await header.dispatchEvent("keydown", {key: "Backspace", code: "Backspace", isComposing: true})
    await page.evaluate(() => {
        const event = new KeyboardEvent("keydown", {key: "Delete", code: "Delete", bubbles: true, cancelable: true})
        event.preventDefault(); document.querySelector("#effect-header")!.dispatchEvent(event)
    })
    expect((await page.evaluate(() => window.r134.state())).present).toBe(true)
    await page.keyboard.press("Delete")
    expect(await page.evaluate(() => window.r134.state())).toMatchObject({present: false, index: 0, undo: true})
    await page.evaluate(() => window.r134.undo())
    expect(await page.evaluate(() => window.r134.state())).toMatchObject({present: true, index: 1, undo: false})
    await page.evaluate(() => window.r134.close())
})
