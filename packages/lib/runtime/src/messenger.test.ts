import {expect, it, vi} from "vitest"
import {Messenger, Port} from "./messenger"

const port = (): Port => ({postMessage: vi.fn(), onmessage: null, onmessageerror: null})
const message = (data: unknown) => ({data} as MessageEvent)

it("keeps a replacement wrapper alive after the previous owner terminates again", () => {
    const transport = port(), old = Messenger.for(transport), retired = vi.fn()
    old.subscribe(retired)
    const staleHandler = transport.onmessage
    old.terminate()
    const current = Messenger.for(transport), receive = vi.fn()
    current.subscribe(receive)
    old.terminate()
    transport.onmessage?.(message("current"))
    expect(receive).toHaveBeenCalledExactlyOnceWith("current")
    staleHandler?.(message("late"))
    expect(retired).not.toHaveBeenCalled()
    current.terminate()
})

it("clears only its own handlers", () => {
    const transport = port(), owner = Messenger.for(transport)
    const replacementMessage = vi.fn(), replacementError = vi.fn()
    transport.onmessage = replacementMessage
    transport.onmessageerror = replacementError
    owner.terminate()
    expect(transport.onmessage).toBe(replacementMessage)
    expect(transport.onmessageerror).toBe(replacementError)
})

it("drops sends and subscriptions from retired wrappers and channels", () => {
    const transport = port(), owner = Messenger.for(transport), channel = owner.channel("test")
    const oldHandler = transport.onmessage
    owner.terminate()
    const observer = vi.fn()
    owner.subscribe(observer)
    owner.send("late")
    channel.send("late")
    oldHandler?.(message("late"))
    expect(transport.postMessage).not.toHaveBeenCalled()
    expect(observer).not.toHaveBeenCalled()
    channel.terminate()
})

it("retires a channel without terminating its shared transport", () => {
    const transport = port(), owner = Messenger.for(transport)
    const retired = owner.channel("retired"), active = owner.channel("active")
    const observer = vi.fn(), activeObserver = vi.fn()
    retired.terminate()
    retired.subscribe(observer)
    retired.send("late")
    active.subscribe(activeObserver)
    active.send("live")
    expect(transport.postMessage).toHaveBeenCalledTimes(1)
    transport.onmessage?.(message({__id__: "42", channel: "active", message: "live"}))
    expect(activeObserver).toHaveBeenCalledExactlyOnceWith("live")
    expect(observer).not.toHaveBeenCalled()
    active.terminate(); owner.terminate()
})
