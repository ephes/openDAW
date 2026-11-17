import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import type {Awareness} from "y-protocols/awareness"
import type * as Identity from "./RoomAwareness"
let readIdentity: typeof Identity.readIdentity
let writeIdentity: typeof Identity.writeIdentity
let RoomAwareness: typeof Identity.RoomAwareness
const pending = vi.hoisted(() => [] as Array<() => void>)
vi.mock("@opendaw/lib-dom", () => ({deferNextFrame: (callback: () => void) => ({
    request: () => pending.push(callback), terminate: () => {pending.length = 0}
})}))
beforeEach(async () => {
    vi.resetModules()
    ;({readIdentity, writeIdentity, RoomAwareness} = await import("./RoomAwareness"))
    const values = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {values.set(key, value)})
    })
    pending.length = 0
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
const deny = (kind: string) => {
    const fail = () => {throw new DOMException("Synthetic storage denial", "SecurityError")}
    if (kind === "getter") {Object.defineProperty(globalThis, "localStorage", {configurable: true, get: fail})}
    else {vi.mocked(localStorage[kind as "getItem" | "setItem"]).mockImplementation(fail)}
}
describe("optional room identity storage", () => {
    it.each(["getter", "getItem", "setItem"])("keeps a usable per-launch identity on %s failure", kind => {
        deny(kind)
        expect(() => readIdentity()).not.toThrow()
        expect(() => writeIdentity("Synthetic Guest", "#61AFEF")).not.toThrow()
        expect(readIdentity()).toEqual({name: "Synthetic Guest", color: "#61AFEF"})
    })
    it.each(["getter", "setItem"])("keeps awareness authoritative on %s failure", kind => {
        deny(kind)
        const setLocalStateField = vi.fn()
        const awareness = new RoomAwareness({setLocalStateField} as unknown as Awareness, "Synthetic Room", "Guest", "#61AFEF")
        expect(() => pending.splice(0).forEach(callback => callback())).not.toThrow()
        awareness.name.setValue("Updated Guest")
        expect(() => pending.splice(0).forEach(callback => callback())).not.toThrow()
        expect(setLocalStateField).toHaveBeenLastCalledWith("user", {name: "Updated Guest", color: "#61AFEF", panel: null})
        awareness.terminate()
    })
    it("keeps a new per-launch identity when old preferences cannot be replaced", () => {
        localStorage.setItem("opendaw:user:name", "Old Guest")
        localStorage.setItem("opendaw:user:color", "#E06C75")
        deny("setItem")
        writeIdentity("Current Guest", "#61AFEF")
        expect(readIdentity()).toEqual({name: "Current Guest", color: "#61AFEF"})
    })
    it("preserves normal persistence", () => {
        writeIdentity("Stored Guest", "#E06C75")
        expect(localStorage.getItem("opendaw:user:name")).toBe("Stored Guest")
        expect(localStorage.getItem("opendaw:user:color")).toBe("#E06C75")
        expect(readIdentity()).toEqual({name: "Stored Guest", color: "#E06C75"})
    })
})

it("loads existing preferences at launch", () => {
    localStorage.setItem("opendaw:user:name", "Existing Guest")
    localStorage.setItem("opendaw:user:color", "#E06C75")
    expect(readIdentity()).toEqual({name: "Existing Guest", color: "#E06C75"})
})
