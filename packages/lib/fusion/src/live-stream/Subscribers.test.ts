import {expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {Address} from "@opendaw/lib-box"
import {Subscribers} from "./Subscribers"

const address = Address.compose(UUID.Lowest, 1)
it("old handles cannot retire the same callback's replacement generation", () => {
    const subscribers = new Subscribers<() => void>()
    const callback = vi.fn()
    const old = subscribers.subscribe(address, callback)
    subscribers.terminate()
    const current = subscribers.subscribe(address, callback)
    old.terminate(); old.terminate()
    expect(subscribers.getOrNull(address)).toEqual([callback])
    current.terminate()
    expect(subscribers.isEmpty(address)).toBe(true)
})
it("terminates each duplicate registration exactly once", () => {
    const subscribers = new Subscribers<() => void>()
    const callback = vi.fn()
    const first = subscribers.subscribe(address, callback)
    const second = subscribers.subscribe(address, callback)
    first.terminate(); first.terminate()
    expect(subscribers.getOrNull(address)).toEqual([callback])
    const third = subscribers.subscribe(address, callback)
    second.terminate(); second.terminate()
    expect(subscribers.getOrNull(address)).toEqual([callback])
    third.terminate()
    expect(subscribers.isEmpty(address)).toBe(true)
})
