import {afterEach, describe, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {createElement} from "./create-element"

const frames = () => {
    let next = 0
    const pending = new Map<number, FrameRequestCallback>()
    const scheduled: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        pending.set(++next, callback)
        scheduled.push(callback)
        return next
    })
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {pending.delete(handle)})
    return {pending, scheduled, tick: () => {
        const callbacks = Array.from(pending.values())
        pending.clear()
        callbacks.forEach(callback => callback(0))
    }}
}
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe("onConnect lifetime", () => {
    it("cancels a discarded deferred view and fences a queued frame before eventual attachment", () => {
        const clock = frames(), lifecycle = new Terminator(), callback = vi.fn()
        const element: HTMLElement = <div tabIndex={-1} onConnectLifecycle={lifecycle}
                                          onConnect={(self: HTMLElement) => {self.focus(); callback(self)}}/>
        clock.tick(); clock.tick()
        expect(clock.pending.size).toBe(1)
        lifecycle.terminate(); lifecycle.terminate()
        expect(clock.pending.size).toBe(0)
        document.body.append(element)
        clock.scheduled.forEach(frame => frame(0))
        clock.tick()
        expect(callback).not.toHaveBeenCalled()
        expect(document.activeElement).not.toBe(element)
        expect(clock.pending.size).toBe(0)
    })
    it("runs exactly once after first connection and consumes the lifecycle attribute", () => {
        const clock = frames(), lifecycle = new Terminator(), callback = vi.fn()
        const element: HTMLElement = <div onConnectLifecycle={lifecycle} onConnect={(self: HTMLElement) => callback(self)}/>
        expect(element.hasAttribute("onConnectLifecycle")).toBe(false)
        document.body.append(element)
        clock.tick(); clock.tick()
        expect(callback.mock.calls).toEqual([[element]])
        expect(clock.pending.size).toBe(0)
        element.remove(); document.body.append(element)
        clock.tick(); lifecycle.terminate()
        expect(callback).toHaveBeenCalledTimes(1)
    })
})
