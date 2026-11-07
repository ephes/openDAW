import {afterEach, describe, expect, it, vi} from "vitest"

afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe("console accessor contracts", () => {
    it("accepts typed setters and retains getter/setter behavior", async () => {
        const target: {opendaw?: {numeric?: number, flag?: boolean}} = {}
        vi.stubGlobal("self", target)
        vi.resetModules()
        const {ConsoleCommands} = await import("./console-commands")
        let numeric = 1
        let flag = false
        ConsoleCommands.exportAccessor("numeric", () => numeric, (value: number) => {numeric = value})
        ConsoleCommands.exportAccessor("flag", () => flag, (value: boolean) => {flag = value})
        const commands = target.opendaw!
        commands.numeric = 7
        commands.flag = true
        expect(numeric).toBe(7)
        expect(flag).toBe(true)
        expect(commands.numeric).toBe(0) // Reading logs the value and reports success.
    })
})
