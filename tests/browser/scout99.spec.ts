import {test} from "@playwright/test"
import type {BrowserFixtures} from "./fixture"

test.beforeEach(async ({page}) => {
    await page.goto("/")
    await page.waitForFunction(() => "fixtures" in window)
})
test("studio selection owns reentrant catchup in Chromium", async ({page}) => {
    await page.evaluate(() => (window as Window & {fixtures: BrowserFixtures}).fixtures.selection())
})
test("portable import bounds decoders and compensates failure before retry", async ({page}) => {
    await page.evaluate(() => (window as Window & {fixtures: BrowserFixtures}).fixtures.portableImport())
})
