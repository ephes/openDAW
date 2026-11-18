import {expect, test} from "@playwright/test"

test("numeric input supports decimal typing, caret edits and tab commit", async ({page}) => {
    await page.goto("/")
    await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic source fixture.
        Object.assign(window, {readNumber: (await import("/r145-input.ts")).numberInput()})
    })
    const read = () => page.evaluate(() => (window as unknown as {readNumber(): number}).readNumber())
    const input = page.locator("#numeric-editor .waveform-offset [contenteditable]")
    await input.focus()
    for (const key of ["1", ".", "2", "5"]) {await page.keyboard.press(key)}
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("7")
    await page.keyboard.press("Tab")
    expect(await read()).toBe(1.75)
    await input.focus()
    await page.keyboard.press("2")
    const inputSession = await page.context().newCDPSession(page)
    const decimal = {code: "NumpadDecimal", key: ".", isKeypad: true, location: 3, windowsVirtualKeyCode: 110}
    await inputSession.send("Input.dispatchKeyEvent", {...decimal, type: "keyDown", text: "."})
    await inputSession.send("Input.dispatchKeyEvent", {...decimal, type: "keyUp"})
    await inputSession.detach()
    await page.keyboard.press("5")
    await page.keyboard.press("Enter")
    expect(await read()).toBe(2.5)
})

test("note timecode commits through Tab and outside clicks", async ({page}) => {
    await page.goto("/")
    await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic source fixture.
        Object.assign(window, {readTiming: (await import("/r145-input.ts")).timeCode()})
    })
    const read = () => page.evaluate(() => (window as unknown as {readTiming(): {position: number, duration: number}}).readTiming())
    const fields = page.locator("#note-properties [contenteditable]")
    const position = fields.nth(3)
    const duration = fields.nth(7)
    const outside = page.getByRole("button", {name: "Outside properties"})
    await position.fill("42")
    await page.keyboard.press("Tab")
    expect(await read()).toEqual({position: 42, duration: 10})
    await expect(position).toHaveText("042")
    await duration.fill("70")
    await outside.click()
    expect(await read()).toEqual({position: 42, duration: 70})
    await duration.fill("2147483648")
    await outside.click()
    expect(await read()).toEqual({position: 42, duration: 70})
    await expect(duration).toHaveText("070")
})
