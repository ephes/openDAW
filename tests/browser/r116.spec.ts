import {expect, test} from "@playwright/test"
import type {BrowserFixtures} from "./fixture"
test("cloud restore and snapshot retain complete local generations under Web Locks", async ({page}) => {
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto("/")
    await page.waitForFunction(() => "fixtures" in window)
    await page.evaluate(() => (window as unknown as Window & {fixtures: BrowserFixtures}).fixtures.cloudPresetGenerations())
    expect(errors).toEqual([])
})
