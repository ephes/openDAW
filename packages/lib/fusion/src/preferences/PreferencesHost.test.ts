import {expect, it, vi} from "vitest"
import {Messenger, Port} from "@opendaw/lib-runtime"
import {PreferencesHost} from "./PreferencesHost"

const endpoint = () => {
    const messages: unknown[] = []
    const port: Port = {onmessage: null, onmessageerror: null,
        postMessage: message => {messages.push(structuredClone(message))}}
    return {messages, messenger: Messenger.for(port)}
}

it.each(["unsubscribe", "host"])("fences queued outbound updates on %s disposal", async disposal => {
    const {messages, messenger} = endpoint(), host = new PreferencesHost({gain: 1})
    const subscription = host.syncWith(messenger)
    expect(messages).toHaveLength(1)
    messages.length = 0
    host.settings.gain = 2
    if (disposal === "unsubscribe") {subscription.terminate()} else {host.terminate()}
    await Promise.resolve()
    expect(messages).toEqual([])
    host.settings.gain = 3
    await Promise.resolve()
    expect(messages).toEqual([])
    subscription.terminate(); host.terminate(); messenger.terminate()
})

it("coalesces current syncs and releases the sender receive subscription", async () => {
    const {messages, messenger} = endpoint(), host = new PreferencesHost({gain: 1})
    const release = vi.fn(), actualSubscribe = messenger.subscribe.bind(messenger)
    vi.spyOn(messenger, "subscribe").mockImplementation(observer => {
        const subscription = actualSubscribe(observer)
        return {terminate: () => {release(); subscription.terminate()}}
    })
    const subscription = host.syncWith(messenger)
    messages.length = 0
    host.settings.gain = 2; host.settings.gain = 4
    await Promise.resolve()
    expect(messages).toEqual([expect.objectContaining({func: "updateSettings", args: [{value: {gain: 4}}]})])
    subscription.terminate()
    expect(release).toHaveBeenCalledOnce()
    subscription.terminate(); host.terminate()
    expect(release).toHaveBeenCalledOnce()
    messenger.terminate()
})

it("does not create a sync after host termination", () => {
    const {messages, messenger} = endpoint(), host = new PreferencesHost({gain: 1})
    host.terminate()
    host.syncWith(messenger).terminate()
    expect(messages).toEqual([])
    messenger.terminate()
})

it("releases sync setup when the initial send throws", () => {
    const host = new PreferencesHost({gain: 1}), release = vi.fn()
    const messenger = {subscribe: () => ({terminate: release}), send: () => {throw new Error("synthetic send")}} as unknown as Messenger
    expect(() => host.syncWith(messenger)).toThrow("synthetic send")
    expect(release).toHaveBeenCalledOnce()
    host.terminate()
    expect(release).toHaveBeenCalledOnce()
})
