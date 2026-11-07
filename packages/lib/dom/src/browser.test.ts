import {afterEach, describe, expect, it, vi} from "vitest"

afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe("browser feature detection", () => {
    it("treats an undefined location and navigator as unavailable", async () => {
        vi.stubGlobal("self", {location: undefined, navigator: undefined})
        vi.stubGlobal("location", undefined)
        vi.stubGlobal("navigator", undefined)
        const {Browser} = await import("./browser")
        expect(Browser.isLocalHost()).toBe(false)
        expect(Browser.isMacOS()).toBe(false)
        expect(Browser.isMobile()).toBe(false)
        expect(Browser.userAgent).toBe("N/A")
    })
})
