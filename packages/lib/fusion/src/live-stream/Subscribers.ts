import {Maybe, SortedSet, Subscription, Terminable} from "@opendaw/lib-std"
import {Address} from "@opendaw/lib-box"

type ListenersEntry<T> = { address: Address, listeners: Map<symbol, T> }

export class Subscribers<T> implements Terminable {
    readonly #subscribers: SortedSet<Address, ListenersEntry<T>>

    constructor() {this.#subscribers = Address.newSet<ListenersEntry<T>>(entry => entry.address)}

    getOrNull(address: Address): Maybe<ReadonlyArray<T>> {
        const entry = this.#subscribers.getOrNull(address)
        return entry === null ? undefined : Array.from(entry.listeners.values())
    }

    isEmpty(address: Address): boolean {return !this.#subscribers.hasKey(address)}

    subscribe(address: Address, listener: T): Subscription {
        const entry = this.#subscribers.getOrNull(address) ?? {address, listeners: new Map<symbol, T>()}
        const token = Symbol()
        if (!this.#subscribers.hasKey(address)) {this.#subscribers.add(entry)}
        entry.listeners.set(token, listener)
        return {
            terminate: () => {
                if (this.#subscribers.getOrNull(address) !== entry || !entry.listeners.delete(token)) {return}
                if (entry.listeners.size === 0) {this.#subscribers.removeByKey(address)}
            }
        }
    }

    terminate(): void {
        this.#subscribers.forEach(entry => entry.listeners.clear())
        this.#subscribers.clear()
    }
}
