import {
    isDefined,
    MutableObservableValue,
    Observer,
    Optional,
    Nullable,
    PathTuple,
    Subscription,
    Terminable,
    tryCatch,
    ValueAtPath
} from "@opendaw/lib-std"
import {PreferencesFacade} from "./PreferencesFacade"
import {PreferencesHost} from "./PreferencesHost"
import {z} from "zod"

export interface Preferences<SETTINGS> {
    get settings(): SETTINGS
    subscribe<P extends PathTuple<SETTINGS>>(
        observer: Observer<ValueAtPath<SETTINGS, P>>, ...path: P): Subscription
    catchupAndSubscribe<P extends PathTuple<SETTINGS>>(
        observer: Observer<ValueAtPath<SETTINGS, P>>, ...path: P): Subscription
    createMutableObservableValue<P extends PathTuple<SETTINGS>>(...path: P)
        : MutableObservableValue<ValueAtPath<SETTINGS, P>> & Terminable
}

export namespace Preferences {
    let storageWarning = false

    const readStorage = (key: string): {storage: Optional<Storage>, stored: Nullable<string>} => {
        const result = tryCatch(() => {
            const storage = globalThis.localStorage
            return {storage, stored: storage?.getItem(key) ?? null}
        })
        if (result.status === "success") {return result.value}
        if (!storageWarning) {
            storageWarning = true
            console.warn("Preference storage unavailable; using defaults")
        }
        return {storage: undefined, stored: null}
    }

    export const host = <SETTINGS extends object>(key: string, zod: z.ZodType<SETTINGS>): PreferencesHost<SETTINGS> => {
        const {storage, stored} = readStorage(key)
        const facade = new PreferencesHost<SETTINGS>(loadFromStorage(stored, zod))
        if (isDefined(storage)) {
            facade.subscribeAll(() => tryCatch(() => storage.setItem(key, JSON.stringify(facade.settings))))
        }
        return facade
    }

    export const facade = <SETTINGS extends object>(key: string, zod: z.ZodType<SETTINGS>): PreferencesFacade<SETTINGS> => {
        const {storage, stored} = readStorage(key)
        const facade = new PreferencesFacade<SETTINGS>(loadFromStorage(stored, zod))
        if (isDefined(storage)) {
            facade.subscribeAll(() => tryCatch(() => storage.setItem(key, JSON.stringify(facade.settings))))
        }
        return facade
    }

    const loadFromStorage = <SETTINGS>(stored: Nullable<string>, zod: z.ZodType<SETTINGS>): SETTINGS => {
        const defaults = zod.parse({})
        if (!isDefined(stored)) {return defaults}
        const {status, value} = tryCatch(() => JSON.parse(stored))
        if (status !== "success" || typeof value !== "object" || value === null) {return defaults}
        const result = zod.safeParse(value)
        if (result.success) {return result.data}
        // Full parse failed (schema changed). Parse each section independently to preserve valid user settings.
        const merged: Record<string, unknown> = {}
        for (const sectionKey of Object.keys(defaults as Record<string, unknown>)) {
            const sectionSchema = (zod as z.ZodObject<Record<string, z.ZodType>>).shape?.[sectionKey]
            if (isDefined(sectionSchema) && isDefined((value as Record<string, unknown>)[sectionKey])) {
                const sectionResult = sectionSchema.safeParse((value as Record<string, unknown>)[sectionKey])
                merged[sectionKey] = sectionResult.success
                    ? sectionResult.data
                    : (defaults as Record<string, unknown>)[sectionKey]
            } else {
                merged[sectionKey] = (defaults as Record<string, unknown>)[sectionKey]
            }
        }
        return merged as SETTINGS
    }
}