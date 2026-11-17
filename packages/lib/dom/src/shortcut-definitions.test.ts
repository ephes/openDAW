import {describe, expect, it} from "vitest"
import {Shortcut} from "./shortcut-manager"
import {ShortcutDefinitions} from "./shortcut-definitions"
const definitions = () => ({action: {shortcut: Shortcut.of("KeyA"), description: "Synthetic"}})
const value = Shortcut.of("KeyB").toJSON()
describe("shortcut import admission", () => {
    it("ignores inherited definition names", () => {
        const defs = definitions()
        expect(() => ShortcutDefinitions.fromJSON(defs, JSON.parse(JSON.stringify({toString: value, constructor: value}))))
            .not.toThrow()
        expect(() => ShortcutDefinitions.fromJSON(defs, JSON.parse(`{"__proto__":${JSON.stringify(value)}}`))).not.toThrow()
        expect(defs.action.shortcut.equals(Shortcut.of("KeyA"))).toBe(true)
    })
    it("does not partially apply malformed later definitions", () => {
        const defs = {...definitions(), later: {shortcut: Shortcut.of("KeyC"), description: "Later"}}
        ShortcutDefinitions.fromJSON(defs, {action: value, later: {code: false}})
        expect(defs.action.shortcut.equals(Shortcut.of("KeyA"))).toBe(true)
    })
    it.each([null, [], {global: null}, {global: []}, {global: {action: value}, later: false}])("rejects malformed contexts atomically: %j", input => {
        const contexts = {global: definitions(), later: definitions()}
        expect(ShortcutDefinitions.fromContextsJSON(contexts, input)).toBe(false)
        expect(contexts.global.action.shortcut.equals(Shortcut.of("KeyA"))).toBe(true)
    })
    it("round trips admitted overrides and ignores unknown contexts", () => {
        const contexts = {global: definitions()}
        expect(ShortcutDefinitions.fromContextsJSON(contexts, {global: {action: value}, constructor: null})).toBe(true)
        expect(ShortcutDefinitions.toJSON(contexts.global)).toEqual({action: value})
    })
})
