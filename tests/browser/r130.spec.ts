import {expect, test} from "@playwright/test"

test("isolated selectors deliver reverse callbacks only to their owning selection", async ({page, context}) => {
    await context.route("https://www.tone3000.com/**", route => route.fulfill({
        contentType: "text/html", body: "<p>Synthetic external selector</p>"
    }))
    await page.goto("/")
    const popups: import("@playwright/test").Page[] = []
    page.on("popup", popup => popups.push(popup))
    await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic fixture.
        const {setup} = await import("/r130-selection.ts")
        Object.assign(window, {toneSelection: setup()})
    })
    await expect.poll(() => popups.length).toBe(2)
    await Promise.all(popups.map(popup => popup.waitForLoadState()))
    const redirects = popups.map(popup => new URL(new URL(popup.url()).searchParams.get("redirect_url")!))
    expect(redirects[0].searchParams.get("selection")).not.toBe(redirects[1].searchParams.get("selection"))
    // COOP may sever the external WindowProxy. That must not cancel a valid selection.
    await page.waitForTimeout(400)
    redirects[1].searchParams.set("tone_url", "https://example.test/second")
    await popups[1].goto(redirects[1].href).catch(error => {if (!popups[1].isClosed()) {throw error}})
    await expect.poll(() => page.evaluate(() => (window as unknown as {toneSelection: {selections: unknown[]}}).toneSelection.selections)).toEqual([{index: 1, value: "https://example.test/second"}])
    expect(popups[0].isClosed()).toBe(false)
    redirects[0].searchParams.set("tone_url", "https://example.test/first")
    await popups[0].goto(redirects[0].href).catch(error => {if (!popups[0].isClosed()) {throw error}})
    await expect.poll(() => page.evaluate(() => (window as unknown as {toneSelection: {selections: unknown[]}}).toneSelection.selections)).toEqual([
        {index: 1, value: "https://example.test/second"}, {index: 0, value: "https://example.test/first"}
    ])
    await expect.poll(() => popups.every(popup => popup.isClosed())).toBe(true)
})

test("selection callback tolerates a redirector that appends tone_url with a second question mark", async ({page}) => {
    const selection = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const toneUrl = "https://example.test/tones/1?format=nam&v=2"
    await page.goto(`/tone3000-callback.html?selection=${selection}?tone_url=${encodeURIComponent(toneUrl)}`)
    await expect(page.locator("#status")).toHaveText("Sending NAM to device...")
    expect(await page.evaluate(id => localStorage.getItem(`tone3000_tone_url:${id}`), selection)).toBe(toneUrl)
})

test("modular previews, graph transactions and deferred views retain current owners", async ({page}) => {
    await page.goto("/")
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic fixture.
        return (await import("/r130-modular.ts")).modularProbe()
    })
    expect(result.cancelled.after).toEqual(result.cancelled.before)
    expect(result.cancelled.wiring).toBe(false)
    expect(result.undo).toBe(true); expect(result.redo).toBe(true)
    expect(result.remaining).toBe(3); expect(result.retired).toBe(0)
    expect(result.livePreview).toBe(3); expect(result.afterBlur).toBe(2)
    expect(result.removed).toBe(true)
})

test("real worker OPFS publishes complete packs and preserves the prior revision on failure", async ({page, context}) => {
    await context.route("https://example.test/**", route => route.fulfill({
        status: route.request().url().endsWith("v2") ? 503 : 200, contentType: "application/json",
        headers: {"Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin"},
        body: JSON.stringify({version: "0.5.4", architecture: "WaveNet", config: {}, weights: [1], metadata: {name: "v1"}})
    }))
    await page.goto("/")
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic fixture.
        return (await import("/r130-opfs.ts")).opfsProbe()
    })
    expect(result.replacement).toEqual([5])
    expect(result.failed).toBe(true)
    expect(result.current).toEqual(result.prior)
    expect(result.model).toContain("v1")
})
