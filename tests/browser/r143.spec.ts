import {expect, test} from "@playwright/test"

type Values = {duration: number, offset: number, gain: number, label: string}
type Harness = {points: {start: number, move: number}, read(): {values: Values, before: Values}} & Record<string, () => unknown>

for (const owner of ["clip", "region"] as const) {
    for (const gesture of ["resize", "slip"] as const) {
        for (const finish of ["approve", "escape", "dispose"] as const) {
            test(`round 143 audio ${owner} ${gesture} ${finish}`, async ({page}) => {
                await page.goto("/")
                const points = await page.evaluate(async ([owner, gesture]) => {
                    // @ts-expect-error Vite serves the synthetic source fixture.
                    const harness = (await import("/r143-audio.ts")).setup(owner, gesture)
                    Object.assign(window, {audio: harness})
                    return harness.points
                }, [owner, gesture] as const)
                const read = () => page.evaluate(() => (window as unknown as {audio: Harness}).audio.read())
                const call = (method: string) => page.evaluate(method => {
                    (window as unknown as {audio: Harness}).audio[method]()
                }, method)
                await page.mouse.move(points.start, 100)
                await page.mouse.down()
                await page.mouse.move((points.start + points.move) / 2, 100)
                await page.mouse.move(points.move, 100)
                await expect.poll(async () => {
                    const {values, before} = await read()
                    return gesture === "resize" ? values.duration !== before.duration : values.offset !== before.offset
                }).toBe(true)
                if (finish === "escape") {await page.keyboard.press("Escape")}
                if (finish === "dispose") {await call("dispose")}
                await page.mouse.up()
                const done = await read()
                if (finish === "approve") {
                    expect(done.values).not.toEqual(done.before)
                    await call("undo")
                    expect((await read()).values).toEqual(done.before)
                } else {
                    expect(done.values).toEqual(done.before)
                    await call("undo")
                    expect((await read()).values).toEqual({...done.before, label: "before"})
                }
                await call("close")
            })
        }
    }
}

test("round 143 content editor subscriptions follow and retire", async ({page}) => {
    await page.goto("/")
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the synthetic source fixture.
        return (await import("/r143-editors.ts")).run()
    })
    expect(result.stale).toBe(0)
    expect(result.current).toBeGreaterThan(0)
    expect(result.closed).toBe(0)
    expect(result.followed).toBeGreaterThan(0)
    expect(result.after).toBe(result.followed)
})
