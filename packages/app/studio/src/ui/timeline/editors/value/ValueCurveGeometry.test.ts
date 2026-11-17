import {expect, it, vi} from "vitest"
import {Curve, Option, ObservableValue, ValueMapping} from "@opendaw/lib-std"
import {EventCollection, Interpolation, ValueEvent} from "@opendaw/lib-dsp"
import {ValueEventBoxAdapter} from "@opendaw/studio-adapters"
import {CanvasPainter, TimelineRange} from "@opendaw/studio-core"
import {createValueEventCapturing} from "./ValueEventCapturing"
import {createValuePainter} from "./ValuePainter"
import {ValueEventOwnerReader} from "../EventOwnerReader"

vi.mock("@opendaw/studio-core", async () => ({...await import("../../../../../../../studio/core/src/ui/canvas/capturing"), ValueStreamRenderer: {render() {}}}))
vi.mock("@/ui/timeline/editors/TimeGridRenderer.ts", () => ({renderTimeGrid() {}}))

it.each([Interpolation.Linear, Interpolation.Curve(0.2), Interpolation.Curve(0.8)])(
    "paints and captures handles/curves in stored BPM on a logarithmic axis: %j", interpolation => {
        const events = EventCollection.create<ValueEventBoxAdapter>(ValueEvent.Comparator)
        for (const [position, value] of [[0, 60], [100, 240]]) {
            events.add({type: "value-event", position, index: 0, value, interpolation} as ValueEventBoxAdapter)
        }
        const range = {unitsPerPixel: 1, unitMin: 1000, unitMax: 1100, unitPadding: 0,
            xToUnit: (x: number) => x + 1000, unitToX: (p: number) => p - 1000} as TimelineRange
        const valueToY = (v: number) => Math.log(v / 60) / Math.log(4) * 100
        const slope = interpolation.type === "curve" ? interpolation.slope : 0.5
        const oracle = (ratio: number) => valueToY(60 + (240 - 60) * Curve.normalizedAt(ratio, slope))
        const reader = {offset: 1000, content: {events}, loopDuration: 1000, hasContent: true,
            canLoop: false, timelineBoxAdapter: {signatureTrack: {}}, hue: 0} as unknown as ValueEventOwnerReader
        const capture = createValueEventCapturing(document.createElement("canvas"), range, valueToY, reader)
        const first = events.asArray()[0]
        expect(capture.captureLocalPoint(50, oracle(0.5))).toEqual({type: "midpoint", event: first})
        expect(capture.captureLocalPoint(25, oracle(0.25))).toEqual({type: "curve", event: first})
        const canvas = document.createElement("canvas")
        canvas.style.fontSize = "16px"
        const arcs: number[][] = []
        const context = {canvas, save() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
            arc: (...args: number[]) => arcs.push(args)}
        const paint = createValuePainter({range, valueToPixel: valueToY, eventMapping: ValueMapping.unipolar(),
            modifyContext: {modifier: Option.None}, snapping: {}, reader,
            valueEditing: {currentValue: 120, anchorModel: ObservableValue.seal(60), affineValueAxis: false}
        } as unknown as Parameters<typeof createValuePainter>[0])
        paint({context} as unknown as CanvasPainter)
        expect(arcs[1][0]).toBe(50 * devicePixelRatio)
        expect(arcs[1][1]).toBeCloseTo(oracle(0.5), 10)
    })
