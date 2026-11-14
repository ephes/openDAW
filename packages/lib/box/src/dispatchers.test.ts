import {describe, expect, it, vi} from "vitest"
import {BoxEditing} from "./editing"
import {Propagation} from "./dispatchers"
import {graph, TestBox} from "./testing/fixtures"

describe("vertex dispatch ownership", () => {
    it("settles deferred subscriptions and preserves the first callback failure", () => {
        const target = graph()
        const editing = new BoxEditing(target)
        const box = editing.modify(() => TestBox.create(target)).unwrap()
        const received = vi.fn()
        const sibling = vi.fn()
        const failure = new Error("subscriber failed")
        let armed = true
        target.subscribeVertexUpdates(Propagation.This, box.getField(0).address, () => {
            if (!armed) {return}
            armed = false
            target.subscribeVertexUpdates(Propagation.This, box.getField(0).address, received)
            throw failure
        })
        target.subscribeVertexUpdates(Propagation.This, box.getField(0).address, sibling)
        target.beginTransaction()
        expect(() => box.getField(0).setValue(true)).toThrow(failure)
        expect(sibling).not.toHaveBeenCalled()
        target.endTransaction()
        expect(target.inTransaction()).toBe(false)
        received.mockClear()
        editing.modify(() => box.getField(0).setValue(false))
        expect(received).toHaveBeenCalledTimes(1)
        expect(box.getField(0).getValue()).toBe(false)
    })

    it("keeps subscriptions deferred across nested events and honors cancellation", () => {
        const target = graph()
        const editing = new BoxEditing(target)
        const box = editing.modify(() => TestBox.create(target)).unwrap()
        const received = vi.fn()
        const cancelled = vi.fn()
        let armed = true
        target.subscribeVertexUpdates(Propagation.This, box.getField(1).address, () => {
            target.subscribeVertexUpdates(Propagation.This, box.getField(3).address, received)
            target.subscribeVertexUpdates(Propagation.This, box.getField(3).address, cancelled).terminate()
        })
        target.subscribeVertexUpdates(Propagation.This, box.getField(0).address, () => {
            if (!armed) {return}
            armed = false
            box.getField(1).setValue("nested")
            box.getField(3).setValue(0.5)
        })
        editing.modify(() => box.getField(0).setValue(true))
        expect(received).not.toHaveBeenCalled()
        editing.modify(() => box.getField(3).setValue(0.75))
        expect(received).toHaveBeenCalledTimes(1)
        expect(cancelled).not.toHaveBeenCalled()
    })
})
