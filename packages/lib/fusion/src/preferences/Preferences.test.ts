import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {z} from "zod"
import {PreferencesFacade} from "./PreferencesFacade"
import {PreferencesHost} from "./PreferencesHost"

const schema = z.object({audio: z.object({gain: z.number().default(1)}).default({gain: 1}), ui: z.object({zoom: z.number().default(2)}).default({zoom: 2})})
beforeEach(() => {
    vi.resetModules()
    const entries = new Map<string, string>()
    const storage: Storage = {
        get length() {return entries.size},
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => {entries.set(key, value)},
        removeItem: key => {entries.delete(key)},
        clear: () => entries.clear(),
        key: index => Array.from(entries.keys())[index] ?? null
    }
    vi.stubGlobal("localStorage", storage)
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe("preference storage fallback", () => {
    it.each(["getter", "getItem"])("initializes safely when %s throws", async failure => {
        vi.resetModules()
        const writes = vi.fn()
        const storageGetter = vi.fn(() => {throw new DOMException("private detail", "SecurityError")})
        vi.spyOn(console, "warn").mockImplementation(() => undefined)
        if (failure === "getter") {
            Object.defineProperty(globalThis, "localStorage", {configurable: true,
                get: storageGetter})
        } else {
            vi.stubGlobal("localStorage", {getItem: () => {throw new Error("private detail")}, setItem: writes})
        }
        const {Preferences} = await import("./Preferences")
        const host = Preferences.host("synthetic", schema)
        const facade = Preferences.facade("synthetic", schema)
        expect(host.settings).toEqual({audio: {gain: 1}, ui: {zoom: 2}})
        expect(facade.settings).toEqual(host.settings)
        host.settings.audio.gain = 3
        facade.settings.audio.gain = 4
        expect(writes).not.toHaveBeenCalled()
        if (failure === "getter") {expect(storageGetter).toHaveBeenCalledTimes(2)}
        expect(console.warn).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private detail")
        host.terminate()
        facade.terminate()
    })
    it("preserves valid persisted sections and persists subsequent updates", async () => {
        localStorage.setItem("synthetic", JSON.stringify({audio: {gain: 3}, ui: {zoom: "obsolete"}}))
        const {Preferences} = await import("./Preferences")
        const host = Preferences.host("synthetic", schema)
        expect(host.settings).toEqual({audio: {gain: 3}, ui: {zoom: 2}})
        host.settings.audio.gain = 5
        expect(JSON.parse(localStorage.getItem("synthetic") ?? "{}").audio.gain).toBe(5)
        host.terminate()
    })
})

describe("preference host binding lifetime", () => {
    it.each(["replace", "release", "terminate"])("fences queued updates on %s", async action => {
        const facade = new PreferencesFacade({gain: 1})
        const first = new PreferencesHost({gain: 0})
        const second = new PreferencesHost({gain: 0})
        const retiredUpdate = vi.spyOn(first, "update")
        facade.setHost(first)
        retiredUpdate.mockClear()
        facade.settings.gain = 2
        if (action === "replace") {facade.setHost(second); facade.settings.gain = 3}
        if (action === "release") {facade.releaseHost()}
        if (action === "terminate") {facade.terminate()}
        await Promise.resolve()
        expect(retiredUpdate).not.toHaveBeenCalled()
        if (action === "replace") {expect(second.settings.gain).toBe(3)}
        facade.terminate()
        first.terminate()
        second.terminate()
    })
    it("coalesces changes to the latest value on the active host", async () => {
        const facade = new PreferencesFacade({gain: 1})
        const host = new PreferencesHost({gain: 0})
        facade.setHost(host)
        const update = vi.spyOn(host, "update")
        facade.settings.gain = 2
        facade.settings.gain = 4
        await Promise.resolve()
        expect(update).toHaveBeenCalledTimes(1)
        expect(host.settings.gain).toBe(4)
        facade.terminate()
        host.terminate()
    })
})
