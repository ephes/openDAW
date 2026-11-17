import {expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {Interpolation} from "@opendaw/lib-dsp"
import {ValueEventBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../../project/ProjectSkeleton"
import {BoxAdapters} from "../../BoxAdapters"
import {BoxAdaptersContext} from "../../BoxAdaptersContext"
import {ValueEventBoxAdapter} from "../event/ValueEventBoxAdapter"
import {ValueEventCollectionBoxAdapter} from "./ValueEventCollectionBoxAdapter"

export const valueFixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const context = {boxGraph} as BoxAdaptersContext
    Object.assign(context, {boxAdapters: new BoxAdapters(context)})
    const editing = new BoxEditing(boxGraph)
    const box = mandatoryBoxes.timelineBox.tempoTrack.events.targetVertex.unwrap().box as ValueEventCollectionBox
    const collection = context.boxAdapters.adapterFor(box, ValueEventCollectionBoxAdapter)
    const create = (position: number, index = 0, value = 0.5) =>
        collection.createEvent({position, index, value, interpolation: Interpolation.Linear})
    return {boxGraph, editing, box, context, collection, create}
}

it("reuses pending keys, preserving the final value and intentional jumps through history", () => {
    const f = valueFixture()
    f.editing.modify(() => {
        const first = f.create(20.9)
        expect(f.create(20.1, 0, 0.7)).toBe(first)
        expect(f.create(20, 1)).not.toBe(first)
    })
    expect(f.box.events.pointerHub.size()).toBe(2)
    expect(f.collection.events.asArray().map(event => [event.position, event.index, event.value]))
        .toEqual([[20, 0, expect.closeTo(0.7)], [20, 1, 0.5]])
    f.editing.undo()
    expect(f.collection.events.length()).toBe(0)
    f.editing.redo()
    expect(f.collection.events.asArray().map(event => event.index)).toEqual([0, 1])
})

it("tracks direct additions, field moves, collection transfers and delete/recreate in a transaction", () => {
    const f = valueFixture()
    f.editing.modify(() => {
        const direct = ValueEventBox.create(f.boxGraph, UUID.generate(), box => {
            box.position.setValue(10); box.events.refer(f.box.events)
        })
        expect(f.create(10).box).toBe(direct)
        direct.position.setValue(30); direct.index.setValue(1)
        expect(f.create(30, 1).box).toBe(direct)
        const other = ValueEventCollectionBox.create(f.boxGraph, UUID.generate())
        direct.events.refer(other.events)
        const replacement = f.create(30, 1)
        expect(replacement.box).not.toBe(direct)
        replacement.box.delete()
        const retry = f.create(30, 1)
        expect(retry).not.toBe(replacement)
        expect(f.create(30, 1)).toBe(retry)
        other.delete()
    })
    expect(f.collection.events.asArray()).toHaveLength(1)
})

it("drops aborted pending keys and resolves restored replacement boxes on retry", () => {
    const f = valueFixture()
    expect(() => f.editing.modify(() => {f.create(10); throw new Error("abort")})).toThrow("abort")
    f.editing.modify(() => {expect(f.create(10).box.isAttached()).toBe(true)})
    const original = f.collection.events.asArray()[0]
    expect(() => f.editing.modify(() => {
        original.box.delete(); f.create(10); throw new Error("abort")
    })).toThrow("abort")
    f.editing.modify(() => {
        const restored = f.create(10, 0, 0.75)
        expect(restored.box.isAttached()).toBe(true)
        expect(restored.box).not.toBe(original.box)
    })
    expect(f.box.events.pointerHub.size()).toBe(1)
})

it.each([100, 200, 400])("does not scan existing events for each of %i new keys", size => {
    const f = valueFixture()
    f.editing.modify(() => {for (let i = 0; i < size; i++) {f.create(i)}})
    const inspections = vi.spyOn(ValueEventBoxAdapter.prototype, "position", "get")
    try {
        f.editing.modify(() => {
            for (let i = size; i < size * 2; i++) {f.create(i)}
            expect(inspections.mock.calls.length).toBeLessThan(size * 10)
        })
    } finally {inspections.mockRestore()}
})
