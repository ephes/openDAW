import {Arrays} from "./arrays"
import {EmptyExec, Exec, Func, tryCatch} from "./lang"
import {Observer} from "./observers"

export interface Terminable {terminate(): void}

export interface TerminableOwner {
    own<T extends Terminable>(terminable: T): T
    ownAll<T extends Terminable>(...terminables: Array<T>): void
    spawn(): Terminator
}

// alias
export type Subscription = Terminable
export type Lifecycle = TerminableOwner

export const Terminable = Object.freeze({
    Empty: {terminate: EmptyExec},
    create: (exec: Exec) => ({terminate: exec}),
    many: (...terminables: Terminable[]): Terminable =>
        ({terminate: (): void => drain(terminables)})
} as const)

const drain = (terminables: Terminable[]): void => {
    const pending = terminables.splice(0)
    const errors: unknown[] = []
    while (pending.length > 0) {
        const result = tryCatch(() => pending.pop()!.terminate())
        if (result.status === "failure") {errors.push(result.error)}
    }
    if (errors.length === 1) {throw errors[0]}
    if (errors.length > 1) {throw new AggregateError(errors, "Multiple cleanup failures", {cause: errors[0]})}
}

export class Terminator implements TerminableOwner, Terminable {
    readonly #terminables: Terminable[] = []

    isEmpty(): boolean {return this.#terminables.length === 0}
    nonEmpty(): boolean {return this.#terminables.length > 0}

    own<T extends Terminable>(terminable: T): T {
        this.#terminables.push(terminable)
        return terminable
    }

    ownAll<T extends Terminable>(...terminables: Array<T>): void {
        for (const terminable of terminables) {this.#terminables.push(terminable)}
    }

    spawn(): Terminator {
        const terminator = new Terminator()
        terminator.own({terminate: () => Arrays.removeOpt(this.#terminables, terminator)})
        return this.own(terminator)
    }

    terminate(): void {drain(this.#terminables)}
}

export class VitalSigns implements Terminable {
    #terminated: boolean = false
    get isTerminated(): boolean {return this.#terminated}
    terminate(): void {this.#terminated = true}
}

export class CascadingSubscriptions {
    #current: Terminator

    constructor() {this.#current = new Terminator()}

    next(): {
        own: (subscription: Subscription) => Subscription
        toObserver: <T>(fn: Func<T, Subscription>) => Observer<T>
    } {
        const current = this.#current
        const nested = current.own(new Terminator())
        let generation = 0
        let active = true
        current.own({terminate: () => {active = false; generation++}})
        this.#current = nested
        return {
            own: (subscription: Subscription): Subscription => {
                if (active) {current.own(subscription)} else {subscription.terminate()}
                return current
            },
            toObserver: <T>(fn: Func<T, Subscription>): Observer<T> => (value: T) => {
                if (!active) {return}
                const ticket = ++generation
                nested.terminate()
                if (!active || ticket !== generation) {return}
                this.#current = nested
                const subscription = fn(value)
                if (active && ticket === generation) {nested.own(subscription)} else {subscription.terminate()}
            }
        }
    }

    append<T>(subscribe: Func<Observer<T>, Subscription>, observer: Func<T, Subscription>): Subscription {
        const {own, toObserver} = this.next()
        return own(subscribe(toObserver(observer)))
    }
}
