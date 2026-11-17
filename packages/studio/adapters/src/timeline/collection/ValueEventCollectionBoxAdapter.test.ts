import {expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID, ValueMapping} from "@opendaw/lib-std"
import {Interpolation} from "@opendaw/lib-dsp"
import {ValueEventBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {TempoGridCursor} from "../../VaryingTempoMap"
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

// Display space is deliberately nonlinear; storage and playback still use BPM.
it.each([Interpolation.Linear, Interpolation.Curve(0.2), Interpolation.Curve(0.8), Interpolation.None])(
    "preserves stored tempo samples and time conversion after a cut: %j", interpolation => {
        const f = valueFixture()
        const mapping = {x: (bpm: number) => Math.log(bpm / 60) / Math.log(4),
            y: (x: number) => 60 * 4 ** x} as ValueMapping<number>
        f.editing.modify(() => {
            f.collection.createEvent({position: 0, index: 0, value: 60, interpolation})
            f.collection.createEvent({position: 3840, index: 0, value: 240, interpolation: Interpolation.None})
        })
        const positions = Array.from({length: 129}, (_, i) => i * 30)
        const before = positions.map(p => f.collection.valueAt(p, 120))
        const elapsed = new TempoGridCursor().integrate(f.collection.events.asArray(), 0, 3840, 120)
        // Stored values and slopes use Float32 fields; allow their roundoff.
        const check = () => {
            positions.forEach((p, i) => expect(f.collection.valueAt(p, 120)).toBeCloseTo(before[i], 4))
            expect(new TempoGridCursor().integrate(f.collection.events.asArray(), 0, 3840, 120)).toBeCloseTo(elapsed, 7)
        }
        f.editing.modify(() => f.collection.cut(1440, mapping))
        check()
        f.editing.undo(); check()
        f.editing.redo(); check()
    })

it("retains identity-mapped parameter interpolation when cutting", () => {
    const f = valueFixture()
    f.editing.modify(() => {f.create(0, 0, 0.2); f.create(100, 0, 0.8)})
    f.editing.modify(() => f.collection.cut(50))
    expect(f.collection.valueAt(25, -1)).toBeCloseTo(0.35)
    expect(f.collection.valueAt(75, -1)).toBeCloseTo(0.65)
})

it("shares one graph update listener across collections and routes transfers between them", () => {
    const {boxGraph} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const context = {boxGraph} as BoxAdaptersContext
    Object.assign(context, {boxAdapters: new BoxAdapters(context)})
    const editing = new BoxEditing(boxGraph)
    const subscribe = vi.spyOn(boxGraph, "subscribeToAllUpdatesImmediate")
    const findBox = vi.spyOn(boxGraph, "findBox")
    const linear = (position: number) => ({position, index: 0, value: 0.5, interpolation: Interpolation.Linear})
    editing.modify(() => {
        const [a, b, c] = [0, 1, 2].map(() => ValueEventCollectionBox.create(boxGraph, UUID.generate()))
        const [left, right, unrelated] = [a, b, c].map(box => context.boxAdapters.adapterFor(box, ValueEventCollectionBoxAdapter))
        expect(subscribe).toHaveBeenCalledTimes(1)
        const event = left.createEvent(linear(40))
        const lookupsPerUpdate = () => {
            findBox.mockClear()
            event.box.value.setValue(event.box.value.getValue() + 0.01)
            return findBox.mock.calls.length
        }
        const before = lookupsPerUpdate()
        const extra = Array.from({length: 20}, () => ValueEventCollectionBox.create(boxGraph, UUID.generate()))
        extra.forEach(box => context.boxAdapters.adapterFor(box, ValueEventCollectionBoxAdapter))
        // Unrelated collections are not visited for an update of another collection's event.
        expect(lookupsPerUpdate()).toBe(before)
        expect(subscribe).toHaveBeenCalledTimes(1)
        event.box.events.refer(b.events)
        expect(left.createEvent(linear(40)).box).not.toBe(event.box)
        expect(right.createEvent(linear(40)).box).toBe(event.box)
        event.box.position.setValue(80)
        expect(right.createEvent(linear(80)).box).toBe(event.box)
        expect(unrelated.createEvent(linear(80)).box).not.toBe(event.box)
        boxGraph.boxes().filter(box => box instanceof ValueEventBox).forEach(box => box.delete())
        ;[a, b, c, ...extra].forEach(box => box.delete())
    })
})
