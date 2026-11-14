import type {BrowserFixtures} from "./fixture"
import {expect, test} from "@playwright/test"

test.beforeEach(async ({page}) => {
    await page.goto("/")
    await page.waitForFunction(() => "fixtures" in window)
})

test("real pointer events preserve gesture identity", async ({page}) => {
    await page.evaluate(() => (window as Window & {fixtures: BrowserFixtures}).fixtures.gestures())
})

test("RoomStatus acknowledges only successful browser clipboard writes", async ({page}) => {
    await page.evaluate(() => (window as Window & {fixtures: BrowserFixtures}).fixtures.clipboard(true))
    await page.evaluate(() => (window as Window & {fixtures: BrowserFixtures}).fixtures.clipboard(false))
})

test("HTML sanitizes in Chromium and fences retirement", async ({page}) => {
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.evaluate(() => (window as Window & {fixtures: BrowserFixtures}).fixtures.html())
    expect(errors).toEqual([])
})
