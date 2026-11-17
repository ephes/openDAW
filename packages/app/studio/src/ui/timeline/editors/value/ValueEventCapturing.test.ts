import {expect, it, vi} from "vitest"
import {EventCollection, Interpolation, ValueEvent} from "@opendaw/lib-dsp"
import {ObservableValue, ValueAxis, ValueMapping} from "@opendaw/lib-std"
import {NoteEventBoxAdapter, ValueEventBoxAdapter} from "@opendaw/studio-adapters"
import {TimelineRange} from "@opendaw/studio-core"
import {createValueEventCapturing} from "./ValueEventCapturing"
import {createPropertyCapturing} from "../notes/property/PropertyEventCapturing"
import {NoteEventOwnerReader, ValueEventOwnerReader} from "../EventOwnerReader"
import {PropertyAccessor} from "../notes/property/PropertyAccessor"

vi.mock("@opendaw/studio-core", () => import("../../../../../../../studio/core/src/ui/canvas/capturing"))

const range = {unitsPerPixel: 1, xToUnit: (x: number) => x, unitToX: (p: number) => p} as TimelineRange
const valueEvent = (position: number, value = 0) => ({type: "value-event", position, index: 0, value,
    interpolation: Interpolation.Linear}) as ValueEventBoxAdapter

it.each([false, true])("captures the nearest automation node with a region offset (reverse=%s)", reverse => {
    const events = EventCollection.create<ValueEventBoxAdapter>(ValueEvent.Comparator)
    const near = valueEvent(10), far = valueEvent(11)
    for (const event of reverse ? [far, near] : [near, far]) {events.add(event)}
    const reader = {offset: 100, content: {events}, loopDuration: 1000} as unknown as ValueEventOwnerReader
    const capture = createValueEventCapturing(document.createElement("canvas"), range, value => value, reader)
    expect(capture.captureLocalPoint(110, 0)).toEqual({type: "event", event: near})
    // Equal distances keep the first candidate in timeline order.
    expect(capture.captureLocalPoint(110.5, 0)).toEqual({type: "event", event: near})
})

it.each([false, true])("captures nearest property nodes, retaining the pixel offset and selected-note priority (%s)", reverse => {
    const near = {position: 10, isSelected: false}, far = {position: 13, isSelected: false}
    const candidates = reverse ? [far, near] : [near, far]
    const owner = {offset: 100, content: {events: {iterateRange: () => candidates.values()}}} as unknown as NoteEventOwnerReader
    const accessor = {valueMapping: ValueMapping.unipolar(), readValue: () => 0} as unknown as PropertyAccessor
    const capture = createPropertyCapturing({valueToAxis: (v: number) => v} as ValueAxis, range,
        ObservableValue.seal(accessor), owner)
    expect(capture.capture(111, 0)).toBe(near)
    expect(capture.capture(112.5, 0)).toBe(candidates[0])
    far.isSelected = true
    expect(capture.capture(111, 0)).toBe(far as unknown as NoteEventBoxAdapter)
})
