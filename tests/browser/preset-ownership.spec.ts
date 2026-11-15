import {expect, test} from "@playwright/test"
import type {BrowserFixtures} from "./fixture"

test.beforeEach(async ({page}) => {
    await page.goto("/")
    await page.waitForFunction(() => "fixtures" in window)
})
test("preset refusal, delayed selections and save confirmations retain their owners", async ({page}) => {
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.evaluate(() => (window as unknown as Window & {fixtures: BrowserFixtures}).fixtures.presetOwnership())
    expect(errors).toEqual([])
})
test("compaction respects seconds with real project adapters and undo", async ({page}) => {
    await page.evaluate(() => (window as unknown as Window & {fixtures: BrowserFixtures}).fixtures.trackCompaction())
})
