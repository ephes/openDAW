import {describe, expect, it, vi} from "vitest"
import {Notifier} from "./notifier"
import {Observable} from "./observables"

describe("subscribeMany acquisition", () => {
    it.each([1, 2])("rolls back earlier subscriptions when source %i throws", failAt => {
        const sources = Array.from({length: 3}, () => new Notifier<number>())
        const acquisition = new Error("acquisition")
        const cleanup = new Error("cleanup")
        const retired: number[] = []
        const observables: Observable<number>[] = sources.map((source, index) => ({
            subscribe: observer => {
                if (index === failAt) {throw acquisition}
                const subscription = source.subscribe(observer)
                return {terminate: () => {
                    subscription.terminate()
                    retired.push(index)
                    throw cleanup
                }}
            }
        }))
        const observer = vi.fn()
        expect(() => Notifier.subscribeMany(observer, ...observables)).toThrow(acquisition)
        expect(retired).toStrictEqual(Array.from({length: failAt}, (_, index) => failAt - index - 1))
        sources.forEach(source => {
            expect(source.isEmpty()).toBe(true)
            source.notify(1)
        })
        expect(observer).not.toHaveBeenCalled()
    })

    it("returns an idempotent owner for all successfully acquired subscriptions", () => {
        const first = new Notifier<number>()
        const second = new Notifier<number>()
        const observer = vi.fn()
        const owner = Notifier.subscribeMany(observer, first, second)
        first.notify(1)
        second.notify(2)
        expect(observer.mock.calls).toStrictEqual([[first], [second]])
        owner.terminate()
        owner.terminate()
        expect(first.isEmpty()).toBe(true)
        expect(second.isEmpty()).toBe(true)
    })
})
