import {expect, test} from "@playwright/test"

for (const layouts of [false, true]) {
    test(`round 142 piano ${layouts ? "layout recovery" : "active boundaries"}`, async ({page}) => {
        await page.goto("/")
        await page.evaluate(async layouts => {
            // @ts-expect-error Vite serves the synthetic source fixture.
            (await import("/r142-piano.ts")).piano(layouts)
        }, layouts)
    })
}

for (const index of [-1, 0, 1, 2]) {
    for (const finish of ["approve", "escape"] as const) {
        test(`round 142 owned note gesture ${index} ${finish}`, async ({page}) => {
            await page.goto("/")
            await page.evaluate(async index => {
                // @ts-expect-error Vite serves the synthetic source fixture.
                Object.assign(window, {notes: (await import("/r142-notes.ts")).setup(index)})
            }, index)
            const read = () => page.evaluate(() => (window as unknown as {notes: {read(): {
                values: number[], preview: number[], before: number[], active: boolean
            }}}).notes.read())
            const call = (method: string) => page.evaluate(method => {
                (window as unknown as {notes: Record<string, () => void>}).notes[method]()
            }, method)
            await page.mouse.move(10, 10); await page.mouse.down(); await page.mouse.move(15, 20)
            await call("swap")
            const pending = await read()
            // Only the original, attached A/C are previewed; newly selected D stays unchanged.
            expect(pending.active).toBe(true)
            expect(pending.preview[0]).not.toBe(pending.before[0])
            expect(pending.preview[3]).toBe(pending.before[3])
            const active = [pending.preview[0], pending.preview[2], pending.preview[3]]
            if (finish === "escape") {await page.keyboard.press("Escape")}
            await page.mouse.up()
            const done = await read()
            expect(done.active).toBe(false)
            const expected = finish === "approve" ? active : [done.before[0], done.before[2], done.before[3]]
            for (const [offset, note] of [0, 2, 3].entries()) {
                // Graph properties use float32 storage.
                expect(done.values[note]).toBeCloseTo(expected[offset], 5)
            }
            if (finish === "approve") {
                await call("undo")
                const restored = await read()
                expect(restored.values).toEqual(restored.before)
            }
            await call("close")
        })
    }
}

test("timeline marquee removes every outside entry in one update and cancels shift inversion", async ({page}) => {
    await page.goto("/")
    await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic source fixture.
        Object.assign(window, {marquee: (await import("/r142-notes.ts")).marquee()})
    })
    const read = () => page.evaluate(() => (window as unknown as {marquee: {read(): number[]}}).marquee.read())
    const start = async () => {
        await page.mouse.move(10, 10)
        await page.mouse.down()
        await page.mouse.move(250, 150)
        await page.mouse.move(450, 150)
    }
    await start()
    await expect.poll(read).toEqual([0, 1, 2, 3])
    await page.mouse.move(50, 150)
    await expect.poll(read).toEqual([])
    await page.keyboard.press("Escape")
    await page.mouse.up()
    await expect.poll(read).toEqual([0, 1, 2])

    await page.keyboard.down("Shift")
    await start()
    await expect.poll(read).toEqual([3])
    await page.keyboard.press("Escape")
    await page.mouse.up()
    await page.keyboard.up("Shift")
    await expect.poll(read).toEqual([0, 1, 2])
    await page.evaluate(() => (window as unknown as {marquee: {close(): void}}).marquee.close())
})
