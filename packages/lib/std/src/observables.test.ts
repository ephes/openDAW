import {describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, MappedMutableObservableValue, MutableObservableOption} from "./observables"
import {Notifier} from "./notifier"

describe("observable catchup ownership", () => {
    it("releases mapped downstream listeners and makes later subscriptions inert", () => {
        const source = new DefaultObservableValue(1)
        const mapped = new MappedMutableObservableValue(source, {fx: value => value * 10, fy: value => value / 10})
        const subscribe = vi.spyOn(Notifier.prototype, "subscribe")
        const observer = vi.fn()
        mapped.subscribe(observer)
        const downstream = subscribe.mock.contexts[0] as Notifier<unknown>
        subscribe.mockRestore()
        expect(downstream.isEmpty()).toBe(false)
        mapped.terminate()
        mapped.terminate()
        expect(downstream.isEmpty()).toBe(true)
        source.setValue(2)
        mapped.subscribe(observer).terminate()
        mapped.catchupAndSubscribe(observer).terminate()
        expect(downstream.isEmpty()).toBe(true)
        expect(observer).not.toHaveBeenCalled()
        expect(mapped.getValue()).toBe(20)
    })

    it("subscribes before initial delivery for default values", () => {
        const source = new DefaultObservableValue(1)
        const seen: number[] = []
        const subscription = source.catchupAndSubscribe(value => {
            seen.push(value.getValue())
            if (value.getValue() === 1) {source.setValue(2)}
        })
        expect(seen).toStrictEqual([1, 2])
        subscription.terminate()
        source.setValue(3)
        expect(seen).toStrictEqual([1, 2])
    })

    it("subscribes before initial delivery for optional values", () => {
        const source = new MutableObservableOption(1)
        const seen: number[] = []
        const subscription = source.catchupAndSubscribe(value => {
            seen.push(value.unwrap())
            if (value.unwrap() === 1) {source.wrap(2)}
        })
        expect(seen).toStrictEqual([1, 2])
        subscription.terminate()
        source.wrap(3)
        expect(seen).toStrictEqual([1, 2])
    })

    it("subscribes before initial delivery for mapped values", () => {
        const source = new DefaultObservableValue(1)
        const mapped = new MappedMutableObservableValue(source, {fx: value => value * 10, fy: value => value / 10})
        const seen: number[] = []
        const subscription = mapped.catchupAndSubscribe(value => {
            seen.push(value.getValue())
            if (value.getValue() === 10) {source.setValue(2)}
        })
        expect(seen).toStrictEqual([10, 20])
        subscription.terminate()
        mapped.terminate()
    })

    it("releases default, optional and mapped observers when catchup throws", () => {
        const source = new DefaultObservableValue(1)
        const optional = new MutableObservableOption(1)
        const mapped = new MappedMutableObservableValue(source, {fx: value => value, fy: value => value})
        for (const observable of [source, optional, mapped]) {
            const failure = new Error("catchup")
            const observer = vi.fn((): void => {throw failure})
            expect(() => observable.catchupAndSubscribe(observer)).toThrow(failure)
            observer.mockImplementation(() => {})
            source.setValue(source.getValue() + 1)
            optional.wrap(optional.unwrap() + 1)
            expect(observer).toHaveBeenCalledTimes(1)
        }
        mapped.terminate()
    })
})

describe("optional resource clearing", () => {
    it("commits empty before disposal and preserves a reentrant replacement", () => {
        const old = {name: "old"}
        const replacement = {name: "replacement"}
        const source = new MutableObservableOption(old)
        const seen: string[] = []
        source.subscribe(value => seen.push(value.mapOr(value => value.name, "empty")))
        const dispose = vi.fn(value => {
            expect(value).toBe(old)
            expect(source.isEmpty()).toBe(true)
            source.clear()
            source.wrap(replacement)
        })
        source.clear(dispose)
        expect(dispose).toHaveBeenCalledExactlyOnceWith(old)
        expect(source.unwrap()).toBe(replacement)
        expect(seen).toStrictEqual(["empty", "replacement"])
    })

    it("keeps the empty transition committed if disposal throws", () => {
        const source = new MutableObservableOption(1)
        const failure = new Error("dispose")
        const observer = vi.fn()
        source.subscribe(observer)
        expect(() => source.clear(() => {throw failure})).toThrow(failure)
        expect(source.isEmpty()).toBe(true)
        expect(observer).toHaveBeenCalledTimes(1)
    })

    it("disposes the detached resource even if an empty observer throws", () => {
        const source = new MutableObservableOption(1)
        const failure = new Error("observer")
        const dispose = vi.fn()
        source.subscribe(() => {throw failure})
        expect(() => source.clear(dispose)).toThrow(failure)
        expect(source.isEmpty()).toBe(true)
        expect(dispose).toHaveBeenCalledExactlyOnceWith(1)
    })
})
