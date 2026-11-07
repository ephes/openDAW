import {afterEach, expect, it, vi} from "vitest"
const original = {debug: console.debug, info: console.info, warn: console.warn}
afterEach(() => {
    console.debug = original.debug; console.info = original.info; console.warn = original.warn
    vi.unstubAllEnvs(); vi.resetModules()
})
it("bounds serialized reports for primitive, custom and structured arguments", async () => {
    vi.stubEnv("PROD", true)
    console.debug = () => {}; console.info = () => {}; console.warn = () => {}
    const {LogBuffer} = await import("./LogBuffer")
    for (let i = 0; i < 30; i++) {
        console.debug("x".repeat(200_000), {toString: () => "y".repeat(200_000)}, {text: "z".repeat(200_000)})
    }
    for (let i = 0; i < 3000; i++) {console.warn("\\\"\n".repeat(100))}
    console.info("newest context")
    const entries = LogBuffer.get()
    expect(JSON.stringify(entries).length).toBeLessThanOrEqual(100_000)
    expect(entries.every(entry => JSON.stringify(entry).length <= 8000)).toBe(true)
    expect(entries.at(-1)?.args).toContain("newest context")
})
