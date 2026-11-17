import {expect, it, vi} from "vitest"
import {Dragging} from "@opendaw/lib-dom"
import {noteGestureFixture} from "./NoteGesture.test-fixture"
import {NotePropertyAccessors} from "./property/PropertyAccessor"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
for (const property of [undefined, ...NotePropertyAccessors]) {
    const label = property?.label ?? "duration"
    it(`${label} owns original surviving targets in preview, commit and undo`, () => {
        const h = noteGestureFixture(property)
        try {
            const before = h.read()
            h.tool.update({clientX: 5, clientY: 20, ctrlKey: false} as Dragging.Event)
            const initialPreview = h.preview()
            h.swap(); h.detach()
            const preview = h.preview()
            expect(preview[0]).toBe(initialPreview[0]); expect(preview[2]).toBe(initialPreview[2])
            expect(preview[3]).toBe(before[3])
            h.editing.mark()
            h.tool.approve()
            h.read().forEach((value, index) => expect(value).toBeCloseTo(preview[index], 5))
            expect(h.read()[0]).not.toBe(before[0]); expect(h.read()[2]).not.toBe(before[2])
            h.editing.undo()
            expect(h.read()).toEqual(before)
        } finally {h.close()}
    })
    it(`${label} survives cleared selection and keeps cancellation local`, () => {
        const h = noteGestureFixture(property)
        try {
            const before = h.read()
            h.selection.deselectAll()
            h.tool.update({clientX: 5, clientY: 1000, ctrlKey: false} as Dragging.Event)
            const preview = h.preview()
            expect(preview[0]).not.toBe(before[0])
            if (property) {expect(preview[0]).toBe(property.valueMapping.y(1))}
            h.tool.cancel(); h.tool.approve()
            expect(h.read()).toEqual(before)
            expect(h.preview()).toEqual(before)
        } finally {h.close()}
    })
    it(`${label} discards externally changed targets`, () => {
        const h = noteGestureFixture(property)
        try {
            h.tool.update({clientX: 5, clientY: 20, ctrlKey: false} as Dragging.Event)
            h.editing.modify(() => property ? property.writeValue(h.notes[0].box, property.valueMapping.y(0.1))
                : h.notes[0].box.duration.setValue(99))
            const value = h.read()[0]
            h.tool.approve()
            expect(h.read()[0]).toBe(value)
        } finally {h.close()}
    })
}

it("duration alignment uses original reference geometry even after its removal and cancels cleanly", () => {
    const h = noteGestureFixture()
    try {
        h.editing.modify(() => h.notes[0].box.delete())
        h.swap()
        h.tool.update({clientX: 5, clientY: 0, ctrlKey: true} as Dragging.Event)
        expect(h.preview()[2]).toBe(11) // reference end 10 + delta 5 - position 4
        h.tool.cancel()
        expect(h.preview()).toEqual(h.read())
        h.tool.update({clientX: 5, clientY: 0, ctrlKey: true} as Dragging.Event)
        h.tool.approve()
        expect(h.read()[2]).toBe(11)
        expect(h.read()[3]).toBe(40)
    } finally {h.close()}
})

for (const property of NotePropertyAccessors) {
    it(`${property.label} clamps downward and never follows a reparented target`, () => {
        const h = noteGestureFixture(property)
        try {
            h.reparent()
            h.tool.update({clientX: 0, clientY: -1000, ctrlKey: false} as Dragging.Event)
            expect(h.preview()[0]).toBe(property.valueMapping.y(0))
            const retired = h.read()[1]
            h.tool.approve()
            expect(h.read()[0]).toBe(property.valueMapping.y(0))
            expect(h.read()[1]).toBe(retired)
        } finally {h.close()}
    })
}
