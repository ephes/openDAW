import {expect, test} from "@playwright/test"

test.beforeEach(async ({page}) => {await page.goto("/")})
const markdown = "# Synthetic heading\n\n[local](/manuals/topic?mode=x#section)\n\n```ts\nconst value = 1\n```\n"

test("notes preserve exact Markdown through preview saves, editing, blur and teardown", async ({page}) => {
    await page.evaluate(async text => {
        // @ts-expect-error Vite serves the synthetic fixture.
        Object.assign(window, {notes: (await import("/r120-studio.ts")).setupNotes(text)})
    }, markdown)
    const read = () => page.evaluate(() => (window as unknown as {notes: {read(): string}}).notes.read())
    const call = (method: string) => page.evaluate(method => {
        (window as unknown as {notes: Record<string, () => void>}).notes[method]()
    }, method)
    await page.keyboard.press("ControlOrMeta+s")
    await page.keyboard.press("ControlOrMeta+s")
    await call("reopen")
    expect(await read()).toBe(markdown)
    const checkbox = page.locator("input[type=checkbox]")
    await checkbox.evaluate((input: HTMLInputElement) => {input.checked = true; input.dispatchEvent(new Event("input"))})
    const edited = markdown + "\nAdditional synthetic note"
    await page.locator("[contenteditable]").fill(edited)
    await page.keyboard.press("ControlOrMeta+s")
    expect(await read()).toBe(edited)
    await page.locator("[contenteditable]").evaluate(element => (element as HTMLElement).blur())
    await page.keyboard.press("ControlOrMeta+s")
    await call("reopen")
    expect(await read()).toBe(edited)
    await page.locator("input[type=checkbox]").evaluate((input: HTMLInputElement) => {
        input.checked = true; input.dispatchEvent(new Event("input"))
    })
    await page.locator("[contenteditable]").fill(markdown)
    await call("close")
    expect(await read()).toBe(markdown)
})

test("Markdown keeps native query/fragment destinations and modified clicks", async ({page}) => {
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic fixture.
        const click = (await import("/r120-studio.ts")).setupLinks()
        return [click("query"), click("section"), click("plain", {ctrlKey: true}),
            click("plain", {metaKey: true}), click("plain", {shiftKey: true}), click("plain", {button: 1})]
    })
    expect(result).toEqual([false, false, false, false, false, false])
    await page.getByRole("link", {name: "section", exact: true}).click()
    await expect(page).toHaveURL(/#section$/)
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000)
    await page.getByRole("link", {name: "query", exact: true}).click()
    await expect(page).toHaveURL(/\/manuals\/topic\?mode=x#section$/)
})

for (const cancel of ["pointercancel", "lostpointercapture"]) {
    test(`auto gain retires ${cancel} and keeps normal capture release completion`, async ({page}) => {
        await page.clock.install()
        await page.evaluate(async () => {
            // @ts-expect-error Vite serves the synthetic fixture.
            Object.assign(window, {gain: await (await import("/r120-studio.ts")).setupGain()})
        })
        const read = () => page.evaluate(() => (window as unknown as {gain: {read(): unknown}}).gain.read())
        await page.locator("#gain").hover()
        await page.mouse.down()
        await page.locator("#gain").dispatchEvent(cancel, {pointerId: 1})
        await page.locator("#gain").dispatchEvent("lostpointercapture", {pointerId: 1})
        expect(await read()).toEqual({volume: 0, edits: 0, listeners: 0, probing: false})
        await page.mouse.up()
        await page.mouse.down()
        await page.evaluate(() => (window as unknown as {gain: {peaks(p: number[]): void}}).gain.peaks([0.5, 0.5]))
        await page.mouse.up()
        await page.clock.fastForward(1000)
        const state = await read() as {volume: number, edits: number, listeners: number}
        expect(state.volume).toBeCloseTo(5.9206, 4)
        expect(state.edits).toBe(1)
        expect(state.listeners).toBe(0)
        await page.evaluate(() => (window as unknown as {gain: {close(): void}}).gain.close())
    })
}

test("unsupported permission query still captures, while a selected missing input is refused", async ({page}) => {
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic fixture.
        return (await import("/r120-studio.ts")).microphoneFallback()
    })
    expect(result).toEqual({devices: 1, stopped: 1, refused: true, selectors: [null, {exact: "removed"}, null]})
})
