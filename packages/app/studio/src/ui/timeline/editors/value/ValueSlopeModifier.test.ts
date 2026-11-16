import {expect, it, vi} from "vitest"
import {EventCollection, Interpolation} from "@opendaw/lib-dsp"
import {Editing, Notifier, Option, Terminable, ValueAxis} from "@opendaw/lib-std"
import {ValueEventBoxAdapter, ValueEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {Dragging} from "@opendaw/lib-dom"
import {ValueSlopeModifier} from "./ValueSlopeModifier"

const setup = () => {
    const events = EventCollection.create<ValueEventBoxAdapter>()
    const collection = {events, subscribeChange: () => Terminable.Empty, box: {isAttached: () => true}} as unknown as ValueEventCollectionBoxAdapter
    const add = (position: number, value: number) => {
        const notifier = new Notifier<void>()
        let attached = true
        const record = {type: "value-event", position, value, index: 0, interpolation: Interpolation.Linear as Interpolation,
            collection: Option.wrap(collection), box: {isAttached: () => attached,
                subscribe: (_propagation: unknown, observer: () => void) => notifier.subscribe(observer)}}
        const adapter = record as unknown as ValueEventBoxAdapter
        events.add(adapter)
        return {adapter, change: (change: Partial<typeof record>) => {
            Object.assign(record, change); events.onIndexingChanged(); notifier.notify()
        }, remove: () => {attached = false; events.remove(adapter); notifier.notify()}}
    }
    const reference = add(0, 0), successor = add(100, 1)
    const editing = {...Editing.Transient}
    vi.spyOn(editing, "modify")
    const construct = {editing, reference: reference.adapter, collection, element: document.createElement("canvas"),
        valueAxis: {valueToAxis: (value: number) => value * 100} as ValueAxis, pointerY: 100}
    const tool = ValueSlopeModifier.create(construct)
    const move = (y: number, altKey = false) => tool.update({clientY: y, altKey} as Dragging.Event)
    return {tool, reference, successor, editing, add, move}
}

it("includes the full first pointer movement and agrees with subdivided motion", () => {
    const one = setup(), many = setup()
    one.move(120)
    many.move(105); many.move(110); many.move(120)
    expect(one.tool.readInterpolation(one.reference.adapter)).not.toEqual(Interpolation.Linear)
    expect(one.tool.readInterpolation(one.reference.adapter)).toEqual(many.tool.readInterpolation(many.reference.adapter))
    one.tool.approve()
    expect(one.reference.adapter.interpolation).not.toEqual(Interpolation.Linear)
})

it.each(["insert", "remove", "detach-reference", "position", "value", "interpolation", "interpolation-aba"])(
    "retires slope approval and preview when the segment changes: %s", change => {
        const h = setup()
        h.move(100); h.move(120)
        if (change === "insert") {h.add(50, 0.5)}
        if (change === "remove") {h.successor.remove()}
        if (change === "detach-reference") {h.reference.remove()}
        if (change === "position") {h.successor.change({position: 150})}
        if (change === "value") {h.successor.change({value: 0.8})}
        if (change === "interpolation" || change === "interpolation-aba") {
            h.reference.change({interpolation: Interpolation.Curve(0.2)})
            if (change === "interpolation-aba") {h.reference.change({interpolation: Interpolation.Linear})}
        }
        const current = h.reference.adapter.interpolation
        expect(h.tool.readInterpolation(h.reference.adapter)).toEqual(current)
        h.tool.approve()
        expect(h.reference.adapter.interpolation).toEqual(current)
        expect(h.editing.modify).not.toHaveBeenCalled()
    })

it("cancellation releases the owned segment subscriptions", () => {
    const h = setup()
    const update = vi.fn()
    h.tool.subscribeUpdate(update)
    h.tool.cancel()
    update.mockClear()
    h.reference.change({value: 0.5})
    h.successor.change({value: 0.8})
    expect(update).not.toHaveBeenCalled()
})
