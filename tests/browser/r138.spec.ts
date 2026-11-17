import {test} from "@playwright/test"

for (const scenario of ["controls", "pianoAndAudio", "panels"] as const) {
    test(`round 138 ${scenario} uses live DOM, graph and audio contracts`, async ({page}) => {
        await page.goto("/")
        await page.evaluate(async scenario => {
            // @ts-expect-error Vite serves the source fixture.
            await (await import("/r138-contracts.ts"))[scenario]()
        }, scenario)
    })
}
