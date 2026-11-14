import {Subscription, Terminable} from "./terminable"
import {Observer} from "./observers"
import {Observable} from "./observables"
import {tryCatch} from "./lang"

export class Notifier<T> implements Observable<T>, Terminable {
    static subscribeMany<T extends Observable<unknown>>(observer: Observer<T>,
                                                    ...observables: ReadonlyArray<T>): Subscription {
        const subscriptions: Subscription[] = []
        const result = tryCatch(() => {
            for (const observable of observables) {
                subscriptions.push(observable.subscribe(() => observer(observable)))
            }
        })
        if (result.status === "failure") {
            while (subscriptions.length > 0) {tryCatch(() => subscriptions.pop()!.terminate())}
            throw result.error
        }
        return Terminable.many(...subscriptions)
    }

    readonly #observers: Set<Observer<T>> = new Set<Observer<T>>() // A set allows us to remove while iterating

    subscribe(observer: Observer<T>): Subscription {
        this.#observers.add(observer)
        return {terminate: (): unknown => this.#observers.delete(observer)}
    }

    isEmpty(): boolean {return this.#observers.size === 0}
    notify(value: T): void {this.#observers.forEach((observer: Observer<T>) => observer(value))}
    observers(): Set<Observer<T>> {return this.#observers}
    terminate(): void {this.#observers.clear()}
}
