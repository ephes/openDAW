import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Subscription} from "./terminable"

const subscriptions: Subscription[] = []
beforeEach(() => vi.resetModules())
afterEach(() => subscriptions.splice(0).forEach(subscription => subscription.terminate()))
describe("RuntimeSignal subscriber lifetime", () => {
    it("terminates idempotently without removing another consumer", async () => {
        const {RuntimeSignal} = await import("./runtime-signal")
        const retired = vi.fn()
        const live = vi.fn()
        const first = RuntimeSignal.subscribe(retired)
        const second = RuntimeSignal.subscribe(live)
        subscriptions.push(first, second)
        first.terminate()
        first.terminate()
        const payload = {type: "storage-refresh", value: 17}
        RuntimeSignal.dispatch(payload)
        expect(retired).not.toHaveBeenCalled()
        expect(live).toHaveBeenCalledTimes(1)
        expect(live).toHaveBeenCalledWith(payload)
        second.terminate()
        RuntimeSignal.dispatch({type: "later"})
        expect(live).toHaveBeenCalledTimes(1)
    })
    it("supports self-unsubscription and synchronous nested payloads", async () => {
        const {RuntimeSignal} = await import("./runtime-signal")
        const deliveries: string[] = []
        const outer = {type: "outer", value: 1}
        const inner = {type: "inner", value: 2}
        const first = RuntimeSignal.subscribe(payload => {
            deliveries.push(`first:${payload.type}`)
            first.terminate()
            if (payload === outer) {RuntimeSignal.dispatch(inner)}
        })
        const second = RuntimeSignal.subscribe(payload => deliveries.push(`second:${payload.type}`))
        subscriptions.push(first, second)
        RuntimeSignal.dispatch(outer)
        expect(deliveries).toEqual(["first:outer", "second:inner", "second:outer"])
        RuntimeSignal.dispatch({type: "after"})
        expect(deliveries.at(-1)).toBe("second:after")
        expect(deliveries).toHaveLength(4)
    })
    it("starts each isolated module with no old subscriptions", async () => {
        const {RuntimeSignal} = await import("./runtime-signal")
        expect(() => RuntimeSignal.dispatch({type: "fresh"})).not.toThrow()
        const observer = vi.fn()
        subscriptions.push(RuntimeSignal.subscribe(observer))
        RuntimeSignal.dispatch({type: "fresh"})
        expect(observer).toHaveBeenCalledTimes(1)
    })
})
