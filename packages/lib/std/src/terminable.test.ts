import {beforeEach, describe, expect, it, vi} from "vitest"
import {Option} from "./option"
import {CascadingSubscriptions, Subscription, Terminable, Terminator} from "./terminable"
import {Observer} from "./observers"
import {Notifier} from "./notifier"
import {Observable} from "./observables"

class TestObservable<T> implements Observable<T> {
    readonly #notifier: Notifier<T>
    #value: T
    constructor(value: T) {
        this.#notifier = new Notifier<T>()
        this.#value = value
    }
    isEmpty(): boolean {return this.#notifier.isEmpty()}
    setValue(value: T): void {
        if (this.#value === value) {return}
        this.#value = value
        this.#notifier.notify(this.#value)
    }
    getValue(): T {return this.#value}
    subscribe(observer: Observer<T>): Terminable {return this.#notifier.subscribe(observer)}
    catchupAndSubscribe(observer: Observer<T>): Terminable {
        observer(this.#value)
        return this.#notifier.subscribe(observer)
    }
    terminate(): void {this.#notifier.terminate()}
    toString(): string {return `{TestObserver value: ${this.#value}`}
}

interface Context {
    targetA: TestObservable<Option<number>>
    targetB: TestObservable<Option<number>>
    bodyA: TestObservable<Option<TestObservable<Option<number>>>>
    bodyB: TestObservable<Option<TestObservable<Option<number>>>>
    root: TestObservable<Option<TestObservable<Option<TestObservable<Option<number>>>>>>
}

beforeEach<Context>(ctx => {
    const targetA = new TestObservable<Option<number>>(Option.None)
    const targetB = new TestObservable<Option<number>>(Option.None)
    const bodyA = new TestObservable<Option<typeof targetA>>(Option.None)
    const bodyB = new TestObservable<Option<typeof targetA>>(Option.None)
    ctx.root = new TestObservable<Option<typeof bodyA>>(Option.None)
    ctx.bodyA = bodyA
    ctx.bodyB = bodyB
    ctx.targetA = targetA
    ctx.targetB = targetB
})

describe("CascadingSubscriptions", () => {
    it("keeps the result installed by a reentrant cleanup", () => {
        const source = new Notifier<number>(), chain = new CascadingSubscriptions()
        const newest = {terminate: vi.fn()}, obsolete = {terminate: vi.fn()}
        const subscription = chain.append(observer => source.subscribe(observer), value => {
            if (value === 1) {return {terminate: () => source.notify(3)}}
            return value === 3 ? newest : obsolete
        })
        source.notify(1)
        source.notify(2)
        expect(obsolete.terminate).not.toHaveBeenCalled()
        expect(newest.terminate).not.toHaveBeenCalled()
        subscription.terminate()
        expect(newest.terminate).toHaveBeenCalledOnce()
    })
    it.each(["next", "append"])("owns only the latest reentrant result (%s)", mode => {
        const source = new Notifier<number>(), chain = new CascadingSubscriptions()
        const old = {terminate: vi.fn()}, latest = {terminate: vi.fn()}
        const observer = (value: number) => {
            if (value === 1) {source.notify(2)}
            return value === 1 ? old : latest
        }
        const next = mode === "next" ? chain.next() : undefined
        const subscription = next ? next.own(source.subscribe(next.toObserver(observer)))
            : chain.append(observer => source.subscribe(observer), observer)
        source.notify(1)
        expect(old.terminate).toHaveBeenCalledOnce()
        expect(latest.terminate).not.toHaveBeenCalled()
        subscription.terminate()
        expect(latest.terminate).toHaveBeenCalledOnce()
        subscription.terminate()
        expect(old.terminate).toHaveBeenCalledOnce()
    })

    it.each(["next", "append"])("retires a result returned after owner termination (%s)", mode => {
        const source = new Notifier<number>(), chain = new CascadingSubscriptions()
        const result = {terminate: vi.fn()}
        let owner: Subscription = Terminable.Empty
        const observer = () => {owner.terminate(); return result}
        if (mode === "next") {
            const next = chain.next()
            owner = next.own(source.subscribe(next.toObserver(observer)))
        } else {owner = chain.append(observer => source.subscribe(observer), observer)}
        source.notify(1)
        expect(result.terminate).toHaveBeenCalledOnce()
        owner.terminate()
        expect(result.terminate).toHaveBeenCalledOnce()
    })
    it<Context>("without", ({root, bodyA, bodyB, targetA, targetB}) => {
        const catchupAndSubscribe = (observer: Observer<Option<number>>): Subscription => {
            const terminator = new Terminator()
            const nested = terminator.own(new Terminator())
            terminator.own(root.catchupAndSubscribe((option: Option<typeof bodyA>) => {
                    nested.terminate()
                    nested.own(option.match({
                        none: () => {
                            observer(Option.None)
                            return Terminable.Empty
                        },
                        some: body => {
                            const sub = nested.own(new Terminator())
                            return body.catchupAndSubscribe((option: Option<typeof targetA>) => {
                                sub.terminate()
                                sub.own(option.match({
                                    none: () => {
                                        observer(Option.None)
                                        return Terminable.Empty
                                    },
                                    some: target => target.catchupAndSubscribe(observer)
                                }))
                            })
                        }
                    }))
                }
            ))
            return terminator
        }
        expect(root.isEmpty()).true
        const subscription = catchupAndSubscribe(_option => {})
        expect(root.isEmpty()).false
        targetA.setValue(Option.wrap(42))
        targetB.setValue(Option.wrap(43))
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        bodyA.setValue(Option.wrap(targetA))
        bodyB.setValue(Option.wrap(targetB))
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        expect(bodyA.isEmpty()).true
        expect(bodyB.isEmpty()).true
        expect(root.isEmpty()).false

        root.setValue(Option.wrap(bodyA)) // point to body A which observes now target A
        expect(bodyA.isEmpty()).false
        expect(targetA.isEmpty()).false
        bodyA.setValue(Option.wrap(targetB)) // point to target B
        expect(bodyA.isEmpty()).false
        expect(bodyB.isEmpty()).true
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).false
        bodyA.setValue(Option.wrap(targetA)) // point to target A
        expect(bodyA.isEmpty()).false
        expect(bodyB.isEmpty()).true
        expect(targetA.isEmpty()).false
        expect(targetB.isEmpty()).true
        subscription.terminate()
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        expect(bodyA.isEmpty()).true
        expect(bodyB.isEmpty()).true
        expect(root.isEmpty()).true
    })

    it<Context>("with", ({root, bodyA, bodyB, targetA, targetB}) => {
        const catchupAndSubscribe = (observer: Observer<Option<number>>): Subscription => {
            const chain = new CascadingSubscriptions()
            return chain.append(observer => root.catchupAndSubscribe(observer), (option: Option<typeof bodyA>) => {
                    return option.match({
                        none: () => {
                            observer(Option.None)
                            return Terminable.Empty
                        },
                        some: body => {
                            return chain.append(observer => body.catchupAndSubscribe(observer), (option: Option<typeof targetA>) => {
                                return option.match({
                                    none: () => {
                                        observer(Option.None)
                                        return Terminable.Empty
                                    },
                                    some: target => target.catchupAndSubscribe(observer)
                                })
                            })
                        }
                    })
                }
            )
        }
        expect(root.isEmpty()).true
        const subscription = catchupAndSubscribe(_option => {})
        expect(root.isEmpty()).false
        targetA.setValue(Option.wrap(42))
        targetB.setValue(Option.wrap(43))
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        bodyA.setValue(Option.wrap(targetA))
        bodyB.setValue(Option.wrap(targetB))
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        expect(bodyA.isEmpty()).true
        expect(bodyB.isEmpty()).true
        expect(root.isEmpty()).false

        root.setValue(Option.wrap(bodyA)) // point to body A which observes now target A
        expect(bodyA.isEmpty()).false
        expect(targetA.isEmpty()).false
        bodyA.setValue(Option.wrap(targetB)) // point to target B
        expect(bodyA.isEmpty()).false
        expect(bodyB.isEmpty()).true
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).false
        bodyA.setValue(Option.wrap(targetA)) // point to target A
        expect(bodyA.isEmpty()).false
        expect(bodyB.isEmpty()).true
        expect(targetA.isEmpty()).false
        expect(targetB.isEmpty()).true
        subscription.terminate()
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        expect(bodyA.isEmpty()).true
        expect(bodyB.isEmpty()).true
        expect(root.isEmpty()).true
    })

    it<Context>("with next", ({root, bodyA, bodyB, targetA, targetB}) => {
        const catchupAndSubscribe = (observer: Observer<Option<number>>): Subscription => {
            const cascading = new CascadingSubscriptions()
            const {own, toObserver} = cascading.next()
            return own(root.catchupAndSubscribe(toObserver((option: Option<typeof bodyA>): Subscription =>
                option.match({
                    none: () => {
                        observer(Option.None)
                        return Terminable.Empty
                    },
                    some: body => {
                        const {own, toObserver} = cascading.next()
                        return own(body.catchupAndSubscribe(toObserver((option: Option<typeof targetA>): Subscription => option.match({
                            none: () => {
                                observer(Option.None)
                                return Terminable.Empty
                            },
                            some: target => target.catchupAndSubscribe(observer)
                        }))))
                    }
                })
            )))
        }
        expect(root.isEmpty()).true
        const subscription = catchupAndSubscribe(_option => {})
        expect(root.isEmpty()).false
        targetA.setValue(Option.wrap(42))
        targetB.setValue(Option.wrap(43))
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        bodyA.setValue(Option.wrap(targetA))
        bodyB.setValue(Option.wrap(targetB))
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        expect(bodyA.isEmpty()).true
        expect(bodyB.isEmpty()).true
        expect(root.isEmpty()).false

        root.setValue(Option.wrap(bodyA)) // point to body A which observes now target A
        expect(bodyA.isEmpty()).false
        expect(targetA.isEmpty()).false
        bodyA.setValue(Option.wrap(targetB)) // point to target B
        expect(bodyA.isEmpty()).false
        expect(bodyB.isEmpty()).true
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).false
        bodyA.setValue(Option.wrap(targetA)) // point to target A
        expect(bodyA.isEmpty()).false
        expect(bodyB.isEmpty()).true
        expect(targetA.isEmpty()).false
        expect(targetB.isEmpty()).true
        subscription.terminate()
        expect(targetA.isEmpty()).true
        expect(targetB.isEmpty()).true
        expect(bodyA.isEmpty()).true
        expect(bodyB.isEmpty()).true
        expect(root.isEmpty()).true
    })
})

describe("composite cleanup failures", () => {
    it.each(["terminator", "many"])("drains %s in reverse order despite errors and reentry", mode => {
        const order: number[] = []
        const primary = new Error("middle cleanup failed")
        let composite: Terminable = Terminable.Empty
        const children = [
            {terminate: () => {order.push(1)}},
            {terminate: () => {order.push(2); throw primary}},
            {terminate: () => {order.push(3); composite.terminate()}}
        ]
        if (mode === "terminator") {
            const terminator = new Terminator()
            terminator.ownAll(...children)
            composite = terminator
        } else {composite = Terminable.many(...children)}
        expect(() => composite.terminate()).toThrow(primary)
        expect(order).toEqual([3, 2, 1])
        expect(() => composite.terminate()).not.toThrow()
        expect(order).toEqual([3, 2, 1])
        if (composite instanceof Terminator) {expect(composite.isEmpty()).toBe(true)}
    })

    it.each(["terminator", "many"])("retains primary and secondary %s failures", mode => {
        const first = new Error("first"), second = new Error("second")
        const children = [{terminate: () => {throw second}}, {terminate: () => {throw first}}]
        const terminator = new Terminator()
        terminator.ownAll(...children)
        const composite = mode === "many" ? Terminable.many(...children) : terminator
        expect(() => composite.terminate()).toThrow(expect.objectContaining({cause: first, errors: [first, second]}))
        expect(() => composite.terminate()).not.toThrow()
    })
})
