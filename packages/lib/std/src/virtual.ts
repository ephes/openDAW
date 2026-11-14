import {Subscription, Terminable, Terminator} from "./terminable"
import {Notifier} from "./notifier"
import {Exec, isDefined, PathTuple, ValueAtPath} from "./lang"
import {Observer} from "./observers"
import {MutableObservableValue, ObservableValue} from "./observables"

export class VirtualObject<T extends object> implements Terminable {
    readonly #terminator = new Terminator()
    readonly #notifier: Notifier<ReadonlyArray<PropertyKey>>
    readonly #data: T
    readonly #proxy: T

    constructor(data: T) {
        this.#data = data
        this.#notifier = this.#terminator.own(new Notifier<ReadonlyArray<PropertyKey>>())
        this.#proxy = this.#createProxy(data, [])
    }

    get data(): T {return this.#data}
    get proxy(): T {return this.#proxy}

    subscribe<P extends PathTuple<T>>(observer: Observer<ValueAtPath<T, P>>, ...path: P): Subscription {
        const getValue = (): ValueAtPath<T, P> =>
            path.reduce<unknown>((object, key) => (object as Record<PropertyKey, unknown>)[key as PropertyKey], this.#proxy) as ValueAtPath<T, P>
        return this.#notifier.subscribe(notifiedPath => {
            if (this.#pathsOverlap(notifiedPath, path as ReadonlyArray<PropertyKey>)) {observer(getValue())}
        })
    }

    catchupAndSubscribe<P extends PathTuple<T>>(observer: Observer<ValueAtPath<T, P>>, ...path: P): Subscription {
        const getValue = (): ValueAtPath<T, P> =>
            path.reduce<unknown>((object, key) => (object as Record<PropertyKey, unknown>)[key as PropertyKey], this.#proxy) as ValueAtPath<T, P>
        observer(getValue())
        return this.subscribe(observer, ...path)
    }

    subscribeAll(observer: Observer<keyof T>): Subscription {
        return this.#notifier.subscribe(path => observer(path[0] as keyof T))
    }

    createMutableObservableValue<P extends PathTuple<T>>(...path: P): MutableObservableValue<ValueAtPath<T, P>> & Terminable {
        const terminator = this.#terminator.own(new Terminator())
        const notifier = terminator.own(new Notifier<ObservableValue<ValueAtPath<T, P>>>())
        const getTarget = (): Record<PropertyKey, unknown> => path.slice(0, -1).reduce<unknown>((object, key) => (object as Record<PropertyKey, unknown>)[key as PropertyKey], this.#proxy) as Record<PropertyKey, unknown>
        const lastKey = path[path.length - 1]
        const observable: MutableObservableValue<ValueAtPath<T, P>> & Terminable = {
            getValue: () => path.reduce<unknown>((object, key) => (object as Record<PropertyKey, unknown>)[key as PropertyKey], this.#proxy) as ValueAtPath<T, P>,
            setValue: (value: ValueAtPath<T, P>) => getTarget()[lastKey as PropertyKey] = value,
            subscribe: (observer: Observer<ObservableValue<ValueAtPath<T, P>>>) =>
                notifier.subscribe(observer),
            catchupAndSubscribe: (observer: Observer<ObservableValue<ValueAtPath<T, P>>>) => {
                observer(observable)
                return notifier.subscribe(observer)
            },
            terminate: () => terminator.terminate()
        }
        terminator.own(this.subscribe(() => notifier.notify(observable), ...path))
        return observable
    }

    update(data: T): void {
        const changedRootKeys = new Set<keyof T>()
        const changes: Exec[] = []
        this.#stageRecursive(this.#data, data, changes, changedRootKeys, new Set())
        for (const change of changes) {change()}
        for (const key of changedRootKeys) {
            this.#notifier.notify([key])
        }
    }

    terminate(): void {
        this.#terminator.terminate()
        this.#notifier.terminate()
    }

    readonly #pathsOverlap = (a: ReadonlyArray<PropertyKey>, b: ReadonlyArray<PropertyKey>): boolean => {
        const minLen = Math.min(a.length, b.length)
        for (let i = 0; i < minLen; i++) {
            if (a[i] !== b[i]) {return false}
        }
        return true
    }

    readonly #stageRecursive = (target: object, source: object, changes: Exec[],
                               changedRootKeys: Set<keyof T>, ancestors: Set<object>, rootKey?: keyof T): void => {
        if (!isPlainRecord(target) || !isPlainRecord(source) || ancestors.has(source)) {
            throw new TypeError("VirtualObject.update requires acyclic plain records")
        }
        ancestors.add(source)
        for (const key of Object.keys(source)) {
            const currentRootKey = rootKey ?? key as keyof T
            const incoming = Object.getOwnPropertyDescriptor(source, key)
            const existing = Object.getOwnPropertyDescriptor(target, key)
            if (!isDefined(incoming) || !Object.hasOwn(incoming, "value")
                || (isDefined(existing) && !Object.hasOwn(existing, "value"))) {
                throw new TypeError("VirtualObject.update does not support accessors")
            }
            let newValue = incoming.value
            const oldValue = existing?.value
            if (isDefined(newValue) && typeof newValue === "object" && !Array.isArray(newValue)) {
                if (isPlainRecord(oldValue)) {
                    this.#stageRecursive(oldValue, newValue, changes, changedRootKeys, ancestors, currentRootKey)
                    continue
                }
                const replacement = {}
                this.#stageRecursive(replacement, newValue, changes, changedRootKeys, ancestors, currentRootKey)
                newValue = replacement
            }
            if (oldValue !== newValue) {
                if (isDefined(existing) ? !existing.writable : !Object.isExtensible(target)) {
                    throw new TypeError("VirtualObject.update target is not writable")
                }
                const descriptor = existing ?? {writable: true, enumerable: true, configurable: true}
                const value = newValue
                changes.push(() => {Object.defineProperty(target, key, {...descriptor, value})})
                changedRootKeys.add(currentRootKey)
            }
        }
        ancestors.delete(source)
    }

    readonly #createProxy = <O extends object>(object: O, path: PropertyKey[]): O =>
        new Proxy(object, {
            get: (target, property) => {
                const value = target[property as keyof O]
                if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                    return this.#createProxy(value as object, [...path, property]) as O[keyof O]
                }
                return value
            },
            set: (target, property, value) => {
                ;(target as Record<PropertyKey, unknown>)[property] = value
                this.#notifier.notify([...path, property])
                return true
            },
            preventExtensions: () => false
        })
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
    if (!isDefined(value) || typeof value !== "object") {return false}
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}
