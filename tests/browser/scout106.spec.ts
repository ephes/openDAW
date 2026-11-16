import {expect, test} from "@playwright/test"
import type {ProjectDialogFixtures} from "./scout106-fixture"

test.beforeEach(async ({page}) => {
    await page.goto("/")
    await page.waitForFunction(() => "fixtures" in window)
})
test("native browse close paths settle selection or cancellation", async ({page}) => {
    for (const path of ["Cancel", "Enter", "Escape", "close", "select"]) {
        await page.evaluate(() => (window as unknown as Window & {fixtures: ProjectDialogFixtures}).fixtures.openProjectDialog("browse"))
        if (path === "Cancel") {await page.getByText("Cancel", {exact: true}).dispatchEvent("click")}
        else if (path === "close") {await page.locator("dialog").evaluate((dialog: HTMLDialogElement) => dialog.close())}
        else if (path === "select") {await page.getByText("Synthetic project", {exact: true}).click()}
        else {await page.keyboard.press(path)}
        await expect.poll(() => page.evaluate(() => (window as unknown as Window & {fixtures: ProjectDialogFixtures}).fixtures.projectDialogOutcome()))
            .toBe(path === "select" ? "resolved" : "rejected")
        await expect(page.locator("dialog")).toHaveCount(0)
    }
})
test("native stem Enter exports once and preserves composing edits", async ({page}) => {
    await page.evaluate(() => (window as unknown as Window & {fixtures: ProjectDialogFixtures}).fixtures.openProjectDialog("stems"))
    const input = page.locator("dialog [contenteditable=true]")
    await input.dispatchEvent("keydown", {code: "Enter", key: "Enter", isComposing: true})
    expect(await page.evaluate(() => (window as unknown as Window & {fixtures: ProjectDialogFixtures}).fixtures.projectDialogOutcome())).toBe("pending")
    await input.fill("Synthetic edited stem")
    await input.press("Enter")
    await expect.poll(() => page.evaluate(() => (window as unknown as Window & {fixtures: ProjectDialogFixtures}).fixtures.projectDialogOutcome())).toBe("resolved")
    await expect(page.locator("dialog")).toHaveCount(0)
})
