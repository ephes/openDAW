import {test} from "@playwright/test"

test('round 139 preserves interchange graphs and independent BPM playback timing', async ({page}) => {
    await page.goto('/')
    await page.evaluate(async () => {
        // @ts-expect-error Vite serves the source fixture.
        await (await import('/r139-interchange.ts')).interchange()
    })
})
