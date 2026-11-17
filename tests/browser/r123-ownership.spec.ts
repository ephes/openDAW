import {expect, test} from "@playwright/test"

test("monitoring replacement and rollback retire real AudioNode edges", async ({page}) => {
    await page.goto("/")
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves this authored fixture module.
        const {monitoringGraph} = await import("/r123-ownership.ts")
        return monitoringGraph()
    })
    expect(result).toEqual({counts: [...Array(11).fill(10), 3, 2], foreignSurvived: true, published: []})
})

test("auto scroll tracks the initiating Chromium pointer and retires active frames", async ({page}) => {
    await page.goto("/")
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves this authored fixture module.
        const {pointerOwnership} = await import("/r123-ownership.ts")
        return pointerOwnership()
    })
    expect(result).toEqual({continued: true, stopped: true, retired: true})
})
