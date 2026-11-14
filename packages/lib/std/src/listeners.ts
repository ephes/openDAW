import {Subscription, Terminable} from "./terminable"
import {int, Procedure, tryCatch} from "./lang"

export class Listeners<T> implements Terminable {
    readonly #set = new Set<T>()
    readonly #proxy: Required<T>

    constructor() {
        this.#proxy = new Proxy({}, {
            get: (_: never, func: string): () => void => (...args: unknown[]): void =>
                this.#set.forEach((entry: T) => {
                    const listener = entry as Record<string, (...args: unknown[]) => unknown>
                    const result = tryCatch(() => listener[func]?.(...args))
                    if (result.status === "failure") {console.warn("Listener failed", result.error)}
                })
        } as const) as Required<T>
    }

    get proxy(): Required<T> {return this.#proxy}
    get size(): int {return this.#set.size}
    subscribe(listener: T): Subscription {
        this.#set.add(listener)
        return {terminate: () => this.#set.delete(listener)}
    }
    forEach(procedure: Procedure<T>): void {this.#set.forEach(procedure)}
    terminate(): void {this.#set.clear()}
}
