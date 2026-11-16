import {expect, it, vi} from "vitest"
import {EventCollection} from "@opendaw/lib-dsp"
import {TransientMarkerBoxAdapter, WarpMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {TimelineRange} from "@opendaw/studio-core"
import {AudioEventOwnerReader} from "../EventOwnerReader"
import {TransientMarkerUtils} from "./TransientMarkerUtils"

vi.mock("@opendaw/studio-core", () => ({ElementCapturing: class {
    constructor(_element: Element, readonly strategy: {capture(x: number, y: number): unknown}) {}
    captureEvent(event: {clientX: number, clientY: number}) {return this.strategy.capture(event.clientX, event.clientY)}
}}))

const markersFor = (values: number[][]) => {
    const markers = EventCollection.create<WarpMarkerBoxAdapter>()
    values.forEach(([position, seconds]) => markers.add({position, seconds} as WarpMarkerBoxAdapter))
    return markers
}

it.each([
    [[0, 0], [1000, 0]], [[0, 1], [1000, 0]], [[0, 0], [0, 1]],
    [[0, 0], [500, 2], [1000, 1]], [[0, 0], [1000, Infinity]],
    [[0, NaN], [1000, 1]], [[0, 0]], []
])("refuses invalid geometry %j for both conversion and capture", (...values) => {
    const markers = markersFor(values)
    expect(TransientMarkerUtils.secondsToUnits(0, markers)).toBeNull()
    const transients = EventCollection.create<TransientMarkerBoxAdapter>()
    transients.add({position: 0} as TransientMarkerBoxAdapter)
    const reader = {offset: 0, audioContent: {waveformOffset: {getValue: () => 0}}} as AudioEventOwnerReader
    const range = {xToUnit: (x: number) => x, unitToX: (x: number) => x} as TimelineRange
    expect(TransientMarkerUtils.createCapturing(document.createElement("canvas"), range, reader, markers, transients)
        .captureEvent({clientX: 0, clientY: 0})).toBeNull()
})

it("interpolates and extrapolates a valid fractional mapping", () => {
    const markers = markersFor([[10, 1], [10.25, 2], [11, 3]])
    expect(TransientMarkerUtils.secondsToUnits(1.5, markers)).toBe(10.125)
    expect(TransientMarkerUtils.secondsToUnits(0, markers)).toBe(9.75)
    expect(TransientMarkerUtils.secondsToUnits(4, markers)).toBe(11.75)
    expect(TransientMarkerUtils.secondsToUnits(NaN, markers)).toBeNull()
})
