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
