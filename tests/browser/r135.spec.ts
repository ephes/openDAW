import {expect, test} from "@playwright/test"

for (const rate of [44100, 48000, 96000]) for (const band of ["highBell", "lowPass"] as const) {
    test(`Revamp ${band} plot matches actual processor impulse response at ${rate} Hz`, async ({page}) => {
        await page.goto("/")
        const samples = await page.evaluate(async ({rate, band}) => {
            // @ts-expect-error Vite serves the source fixture.
            return (await import("/r135-revamp.ts")).response(rate, band)
        }, {rate, band})
        for (const sample of samples) expect(sample.plotted, `${sample.hz} Hz`).toBeCloseTo(sample.actual, 2)
    })
}

test("Revamp silence and mixed spectra keep finite paths through narrow/empty resizes", async ({page}) => {
    await page.goto("/")
    const results = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the source fixture.
        return (await import("/r135-revamp.ts")).spectrumGeometry()
    })
    for (const result of results) {
        expect(result.finite).toBe(true)
        expect(result.maxY).toBeLessThanOrEqual(200)
        expect(result.minY).toBeGreaterThanOrEqual(0)
        if (result.width > 1 && result.peak) {
            expect(result.minY).toBeLessThan(100)
            expect(result.pixels).toBe(true)
        }
        if (result.width > 0 && !result.peak) expect(result.minY).toBe(200)
    }
})
