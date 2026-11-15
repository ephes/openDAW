import {expect, test} from "@playwright/test"

test("script processors preserve contracts inside a real AudioWorklet with fake MIDI", async ({page}) => {
    await page.goto("/")
    const result = await page.evaluate(async () => {
        const context = new AudioContext()
        try {
            await context.audioWorklet.addModule("/script-worklet.ts")
            const node = new AudioWorkletNode(context, "script-contracts")
            const result = new Promise<{ok: boolean, error?: string}>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("worklet did not complete")), 10000)
                node.port.onmessage = event => {clearTimeout(timer); resolve(event.data)}
                node.onprocessorerror = () => {clearTimeout(timer); reject(new Error("worklet processor error"))}
            })
            node.connect(context.destination)
            await context.resume()
            return await result
        } finally {await context.close()}
    })
    expect(result).toEqual({ok: true})
})
