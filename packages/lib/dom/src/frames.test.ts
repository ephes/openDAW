import {afterEach, describe, expect, it, vi} from "vitest"
import {AnimationFrame} from "./frames"

const driver = () => {
    let nextId = 0
    const pending = new Map<number, FrameRequestCallback>()
    const owner = {
        requestAnimationFrame: (callback: FrameRequestCallback): number => {
            pending.set(++nextId, callback)
            return nextId
        },
        cancelAnimationFrame: (id: number): void => {pending.delete(id)}
    } as WindowProxy
    return {owner, pending, tick: (timestamp: number): void => {
        const jobs = [...pending.values()]
        pending.clear()
        jobs.forEach(job => job(timestamp))
    }}
}

afterEach(() => {AnimationFrame.terminate(); vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe("frame dispatch", () => {
    it("isolates failures and never replays one-shot work", () => {
        const report = vi.fn()
        vi.stubGlobal("reportError", report)
        vi.spyOn(console, "error").mockImplementation(report)
        const clock = driver()
        const calls: string[] = []
        const failure = new Error("frame")
        AnimationFrame.add(() => calls.push("recurring-before"))
        AnimationFrame.add(() => {throw failure})
        AnimationFrame.add(() => calls.push("recurring-after"))
        AnimationFrame.once(() => calls.push("once-before"))
        AnimationFrame.once(() => {throw failure})
        AnimationFrame.once(() => calls.push("once-after"))
        AnimationFrame.start(clock.owner)
        clock.tick(100)
        clock.tick(120)
        expect(calls).toEqual(["recurring-before", "recurring-after", "once-before", "once-after", "recurring-before", "recurring-after"])
        expect(report).toHaveBeenCalledTimes(3)
    })

    it.each(["stop", "terminate", "switch"] as const)("fences a retired snapshot on %s", action => {
        const oldDriver = driver(), newDriver = driver()
        const sibling = vi.fn(), once = vi.fn()
        let first = true
        AnimationFrame.add(() => {
            if (!first) {return}
            first = false
            if (action === "terminate") {AnimationFrame.terminate()}
            else if (action === "stop") {AnimationFrame.stop()}
            else {AnimationFrame.start(newDriver.owner)}
        })
        AnimationFrame.add(sibling)
        AnimationFrame.once(once)
        AnimationFrame.start(oldDriver.owner)
        const staleCallback = [...oldDriver.pending.values()][0]
        oldDriver.tick(100)
        expect(sibling).not.toHaveBeenCalled()
        expect(once).not.toHaveBeenCalled()
        expect(oldDriver.pending.size).toBe(0)
        if (action !== "switch") {AnimationFrame.start(newDriver.owner)}
        expect(newDriver.pending.size).toBe(1)
        staleCallback(500) // A cancelled browser callback must not revive its driver.
        expect(newDriver.pending.size).toBe(1)
        newDriver.tick(1)
        expect(sibling).toHaveBeenCalledTimes(action === "terminate" ? 0 : 1)
        expect(once).not.toHaveBeenCalled()
        expect(newDriver.pending.size).toBe(1)
    })

    it("keeps work added during dispatch for the next frame and preserves throttling", () => {
        const clock = driver(), later = vi.fn(), recurring = vi.fn()
        AnimationFrame.add(recurring)
        AnimationFrame.once(() => AnimationFrame.once(later))
        AnimationFrame.start(clock.owner)
        clock.tick(0)
        expect(recurring).toHaveBeenCalledTimes(1)
        expect(later).not.toHaveBeenCalled()
        clock.tick(8)
        expect(later).not.toHaveBeenCalled()
        clock.tick(16)
        expect(later).toHaveBeenCalledTimes(1)
        expect(recurring).toHaveBeenCalledTimes(2)
    })
})
