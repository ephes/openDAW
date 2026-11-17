import {Shortcut} from "./shortcut-manager"
import {JSONValue} from "@opendaw/lib-std"

export type ShortcutDefinition = { shortcut: Shortcut, description: string }

export type ShortcutDefinitions = Record<string, ShortcutDefinition>

export namespace ShortcutDefinitions {
    export const copy = <T extends ShortcutDefinitions>(defs: T): T => {
        const result: ShortcutDefinitions = {}
        for (const [key, {shortcut, description}] of Object.entries(defs)) {
            result[key] = {shortcut: shortcut.copy(), description}
        }
        return result as T
    }

    export const copyInto = (source: ShortcutDefinitions, target: ShortcutDefinitions): void => {
        for (const [key, {shortcut}] of Object.entries(source)) {
            target[key].shortcut.overrideWith(shortcut.copy())
        }
    }

    export const toJSON = (defs: ShortcutDefinitions): JSONValue => {
        const result: Record<string, JSONValue> = {}
        for (const [key, {shortcut}] of Object.entries(defs)) {
            result[key] = shortcut.toJSON()
        }
        return result
    }

    export const fromJSON = (defs: ShortcutDefinitions, values: JSONValue | undefined): boolean => {
        if (typeof values !== "object" || values === null || Array.isArray(values)) {return false}
        const overrides: Array<() => void> = []
        for (const [key, value] of Object.entries(values)) {
            if (!Object.hasOwn(defs, key)) {continue}
            if (value === undefined) {return false}
            const shortcut = Shortcut.fromJSON(value)
            if (shortcut.isEmpty()) {return false}
            overrides.push(() => defs[key].shortcut.overrideWith(shortcut.unwrap()))
        }
        overrides.forEach(apply => apply())
        return true
    }

    export const fromContextsJSON = (target: Record<string, ShortcutDefinitions>, values: JSONValue | undefined): boolean => {
        if (typeof values !== "object" || values === null || Array.isArray(values)) {return false}
        const staged: Array<[ShortcutDefinitions, ShortcutDefinitions]> = []
        for (const [key, value] of Object.entries(values)) {
            if (!Object.hasOwn(target, key)) {continue}
            const copy = ShortcutDefinitions.copy(target[key])
            if (!fromJSON(copy, value)) {return false}
            staged.push([copy, target[key]])
        }
        staged.forEach(([source, destination]) => copyInto(source, destination))
        return true
    }
}

export namespace ShortcutValidator {
    export const validate = <T extends ShortcutDefinitions>(actions: T): T => {
        const entries = Object.entries(actions)
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                if (entries[i][1].shortcut.equals(entries[j][1].shortcut)) {
                    alert(`Shortcut conflict: '${entries[i][0]}' and '${entries[j][0]}' both use ${entries[i][1].shortcut.format()}`)
                }
            }
        }
        return actions
    }
}