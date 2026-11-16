import {expect, it, vi} from "vitest"
import {EventCollection} from "@opendaw/lib-dsp"
import {Option} from "@opendaw/lib-std"
import {WarpMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {TimelineRange} from "@opendaw/studio-core"
import {AudioEventOwnerReader} from "../EventOwnerReader"
import {WarpMarkerUtils} from "./WarpMarkerUtils"

vi.mock("@opendaw/studio-core", () => ({ElementCapturing: class {
    constructor(_element: Element, readonly strategy: {capture(x: number, y: number): unknown}) {}
    captureEvent(event: {clientX: number, clientY: number}) {return this.strategy.capture(event.clientX, event.clientY)}
}}))

it.each([[10, 12], [12, 10]])("captures the nearest marker regardless of insertion order: %j", (...positions) => {
    const markers = EventCollection.create<WarpMarkerBoxAdapter>()
    positions.forEach(position => markers.add({position} as WarpMarkerBoxAdapter))
    const range = {xToUnit: (x: number) => x, unitToX: (x: number) => x} as TimelineRange
    const reader = {offset: 0, audioContent: {optWarpMarkers: Option.wrap(markers)}} as AudioEventOwnerReader
    const capturing = WarpMarkerUtils.createCapturing(document.createElement("canvas"), range, reader, 4)
    const target = capturing.captureEvent({clientX: 10.5, clientY: 0})
    expect(target?.position).toBe(10)
    markers.remove(target!) // the same target drives double-click deletion
    expect(markers.asArray().map(marker => marker.position)).toEqual([12])
})

it("keeps the first marker on an equal-distance tie", () => {
    const markers = EventCollection.create<WarpMarkerBoxAdapter>()
    markers.add({position: 10} as WarpMarkerBoxAdapter)
    markers.add({position: 12} as WarpMarkerBoxAdapter)
    const range = {xToUnit: (x: number) => x, unitToX: (x: number) => x} as TimelineRange
    const reader = {offset: 0, audioContent: {optWarpMarkers: Option.wrap(markers)}} as AudioEventOwnerReader
    expect(WarpMarkerUtils.createCapturing(document.createElement("canvas"), range, reader, 4)
        .captureEvent({clientX: 11, clientY: 0})?.position).toBe(10)
})

it("finds strict fractional neighbors without a one-pulse gap", () => {
    const markers = EventCollection.create<WarpMarkerBoxAdapter>()
    const values = [10, 10.25, 11].map(position => ({position}) as WarpMarkerBoxAdapter)
    values.forEach(marker => markers.add(marker))
    expect(WarpMarkerUtils.findAdjacent(10.25, markers, false)).toEqual([values[0], values[2]])
    expect(WarpMarkerUtils.findAdjacent(10, markers, false)).toEqual([null, values[1]])
    expect(WarpMarkerUtils.findAdjacent(10.1, markers, true)).toEqual([values[0], values[1]])
    expect(WarpMarkerUtils.findAdjacent(10.25, markers, true)).toEqual([values[1], values[2]])
})
