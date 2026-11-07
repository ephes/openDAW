import {Subscription, Terminable, Terminator} from "./terminable"
import {Notifier} from "./notifier"
import {PathTuple, ValueAtPath} from "./lang"
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
        this.#updateRecursive(this.#data, data, changedRootKeys)
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

    readonly #updateRecursive = (target: object, source: object, changedRootKeys: Set<keyof T>, rootKey?: keyof T): void => {
        const targetRecord = target as Record<string, unknown>
        const sourceRecord = source as Record<string, unknown>
        for (const key of Object.keys(source)) {
            const currentRootKey = rootKey ?? key as keyof T
            const newValue = sourceRecord[key]
            const oldValue = targetRecord[key]
            if (newValue !== null && typeof newValue === "object" && !Array.isArray(newValue)) {
                this.#updateRecursive(targetRecord[key] as object, newValue, changedRootKeys, currentRootKey)
            } else if (oldValue !== newValue) {
                targetRecord[key] = newValue
                changedRootKeys.add(currentRootKey)
            }
        }
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