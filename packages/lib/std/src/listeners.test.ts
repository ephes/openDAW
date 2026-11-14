import {describe, expect, it, vi} from "vitest"
import {Listeners} from "./listeners"

describe("listeners", () => {
    it.each(["class", "object"])("isolates %s listener failures and preserves each method receiver", kind => {
        const listeners = new Listeners<{onSignal(value: number): void}>()
        const calls: string[] = []
        class Listener {
            constructor(readonly label: string, readonly fails = false) {}
            onSignal(value: number): void {
                calls.push(`${this.label}:${value}`)
                if (this.fails) {throw new Error("synthetic listener failure")}
            }
        }
        const first = kind === "class" ? new Listener("first", true) : {
            label: "first", onSignal(value: number) {
                calls.push(`${this.label}:${value}`)
                throw new Error("synthetic listener failure")
            }
        }
        listeners.subscribe(first)
        listeners.subscribe(new Listener("class"))
        listeners.subscribe({onSignal: value => calls.push(`object:${value}`)})
        listeners.subscribe({} as {onSignal(value: number): void})
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        try {
            expect(() => listeners.proxy.onSignal(42)).not.toThrow()
            expect(calls).toEqual(["first:42", "class:42", "object:42"])
            expect(warning).toHaveBeenCalledOnce()
        } finally {warning.mockRestore()}
    })
    interface Foo {
        onSignal(): void
    }

    it("will call", () => {
        const listeners = new Listeners<Foo>()
        const listener = vi.fn()
        const subscription = listeners.subscribe({onSignal: () => listener()})
        expect(listener).toBeCalledTimes(0)
        listeners.proxy.onSignal()
        expect(listener).toBeCalledTimes(1)
        listeners.proxy.onSignal()
        expect(listener).toBeCalledTimes(2)
        subscription.terminate()
        listeners.proxy.onSignal()
        expect(listener).toBeCalledTimes(2)
    })
})
