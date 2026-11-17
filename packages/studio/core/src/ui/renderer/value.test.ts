import {afterEach, expect, it, vi} from "vitest"
import {Curve} from "@opendaw/lib-std"
import {Interpolation, LoopableRegion, ValueEvent} from "@opendaw/lib-dsp"
import {TimelineRange} from "../timeline/TimelineRange"
import {ValueStreamRenderer} from "./value"

afterEach(() => vi.unstubAllGlobals())
const render = (interpolation: Interpolation, from = 0, to = 100, affine = false) => {
    const points: [number, number][] = []
    vi.stubGlobal("devicePixelRatio", 1)
    vi.stubGlobal("Path2D", class {
        moveTo(x: number, y: number) {points.push([x, y])}
        lineTo(x: number, y: number) {points.push([x, y])}
        closePath() {}
    })
    let stroke: [number, number][] = []
    const context = {beginPath() {}, stroke() {stroke = points.slice()}, fill() {}} as unknown as CanvasRenderingContext2D
    const range = {unitToX: (p: number) => p} as TimelineRange
    const events: ValueEvent[] = [Object.freeze({type: "value-event", position: 0, index: 0, value: 60, interpolation}),
        Object.freeze({type: "value-event", position: 100, index: 0, value: 240, interpolation: Interpolation.None})]
    ValueStreamRenderer.render(context, range, events.values(), affine ? v => v : v => Math.log(v / 60) / Math.log(4),
        "red", 0.2, 60, {rawStart: 0, resultStart: from, resultEnd: to} as LoopableRegion.LoopCycle, affine)
    return stroke
}

it.each([Interpolation.Linear, Interpolation.Curve(0.2), Interpolation.Curve(0.8)])(
    "maps stored BPM before drawing full and clipped ramps: %j", interpolation => {
        const slope = interpolation.type === "curve" ? interpolation.slope : 0.5
        const oracle = (x: number) => Math.log((60 + (240 - 60) * Curve.normalizedAt(x / 100, slope)) / 60) / Math.log(4)
        for (const [from, to] of [[0, 100], [25, 50], [10, 75]]) {
            const points = render(interpolation, from, to)
            expect(points.length).toBeLessThanOrEqual(to - from + 4)
            expect(points.length).toBeGreaterThan(2)
            for (const [x, y] of points) {
                expect(x).toBeGreaterThanOrEqual(from)
                expect(x).toBeLessThanOrEqual(to)
                expect(y).toBeCloseTo(oracle(x), 10)
            }
            expect(points.at(-1)).toEqual([to, expect.closeTo(oracle(to), 10)])
        }
    })

it("retains the cheap affine linear path", () => {
    expect(render(Interpolation.Linear, 25, 75, true)).toEqual([[25, 105], [75, 195]])
})

it("bounds work by visible pixels rather than offscreen segment length", () => {
    expect(render(Interpolation.Curve(0.2), 49, 51).length).toBeLessThanOrEqual(6)
})
