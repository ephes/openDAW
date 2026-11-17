import {expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Interpolation} from "@opendaw/lib-dsp"
import {Selection, ValueAxis, ValueMapping} from "@opendaw/lib-std"
import {BoxAdapters, BoxAdaptersContext, ProjectSkeleton, ValueEventBoxAdapter, ValueEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {Dragging} from "@opendaw/lib-dom"
import {ValueEventEditing} from "./ValueEventEditing"
import {ValueMoveModifier} from "./ValueMoveModifier"
import {ValueContext} from "./ValueContext"
import {Snapping} from "../../Snapping"

const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const context = {boxGraph} as BoxAdaptersContext
    Object.assign(context, {boxAdapters: new BoxAdapters(context)})
    const editing = new BoxEditing(boxGraph)
    const box = mandatoryBoxes.timelineBox.tempoTrack.events.targetVertex.unwrap().box as ValueEventCollectionBox
    const collection = context.boxAdapters.adapterFor(box, ValueEventCollectionBoxAdapter)
    editing.modify(() => {
        for (const position of [0, 20, 40]) {
            collection.createEvent({position, index: 0, value: position / 100, interpolation: Interpolation.Linear})
        }
    })
    const check = () => {
        const pointers = box.events.pointerHub.incoming().map(({box}) => box.address.toString()).sort()
        expect(collection.events.asArray().map(event => event.address.toString()).sort()).toEqual(pointers)
        expect(collection.events.asArray().map(event => event.position)).toEqual([0, 20, 40])
        expect(collection.valueAt(10, -1)).toBeCloseTo(0.1)
    }
    return {editing, collection, check}
}

it("restores the editor index after aborting a synchronous delete and supports subsequent history", () => {
    const f = fixture()
    expect(() => f.editing.modify(() => {
        ValueEventEditing.deleteEvent(f.collection, f.collection.events.asArray()[1])
        throw new Error("abort delete")
    })).toThrow("abort delete")
    f.check()
    f.editing.modify(() => ValueEventEditing.deleteEvent(f.collection, f.collection.events.asArray()[1]))
    expect(f.collection.events.length()).toBe(2)
    f.editing.undo(); f.check()
    f.editing.redo(); expect(f.collection.events.length()).toBe(2)
})

it("restores every point after a multi-point move fails after its first write", () => {
    const f = fixture()
    const events = f.collection.events.asArray().slice()
    events.forEach(event => event.onSelected())
    const modifier = ValueMoveModifier.create({editing: f.editing, collection: f.collection,
        element: document.createElement("canvas"), reference: events[0], pointerPulse: 0, pointerValue: 0,
        context: {currentValue: 0, quantize: (value: number) => value} as ValueContext,
        selection: {select: event => event.onSelected(), deselect: event => event.onDeselected()} as Selection<ValueEventBoxAdapter>,
        valueAxis: {axisToValue: (y: number) => y, valueToAxis: (value: number) => value} as ValueAxis,
        eventMapping: ValueMapping.unipolar(), snapping: {computeDelta: () => 10} as unknown as Snapping})
    modifier.update({clientX: 10, clientY: 0, shiftKey: true, altKey: false, ctrlKey: false} as Dragging.Event)
    const failure = vi.spyOn(events[1], "copyFrom").mockImplementation(() => {throw new Error("abort move")})
    expect(() => modifier.approve()).toThrow("abort move")
    failure.mockRestore()
    f.check()
    modifier.approve()
    expect(f.collection.events.asArray().map(event => event.position)).toEqual([10, 30, 50])
    f.editing.undo(); f.check()
    f.editing.redo()
    expect(f.collection.events.asArray().map(event => event.position)).toEqual([10, 30, 50])
})
