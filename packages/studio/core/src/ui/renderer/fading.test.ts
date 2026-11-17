import {afterEach, expect, it, vi} from "vitest"
import {Curve} from "@opendaw/lib-std"
import {FadingEnvelope} from "@opendaw/lib-dsp"
import {TimelineRange} from "../timeline/TimelineRange"
import {AudioFadingRenderer} from "./fading"

class CountingPath {
    readonly points: [number, number][] = []
    lines = 0
    moveTo(x: number, y: number) {this.points.push([x, y])}
    lineTo(x: number, y: number) {
        this.lines++
        if (this.points.length < 1000) {this.points.push([x, y])}
    }
}

afterEach(() => vi.unstubAllGlobals())

const render = (config: FadingEnvelope.Config, end: number, viewFrom: number, dpr = 1, height = 100, viewSize = 200) => {
    vi.stubGlobal("devicePixelRatio", dpr)
    vi.stubGlobal("Path2D", CountingPath)
    const strokes: {points: [number, number][], lines: number}[] = []
    const fills: CountingPath[] = []
    const handles: number[] = []
    const context = {
        stroke(path: CountingPath) {strokes.push({points: path.points.slice(), lines: path.lines})},
        fill(path?: CountingPath) {if (path) {fills.push(path)}},
        beginPath() {},
        arc(x: number) {handles.push(x)}
    } as unknown as CanvasRenderingContext2D
    const range = new TimelineRange()
    range.maxUnits = Math.max(end, viewFrom + viewSize) * 2
    range.width = 200
    range.showUnitInterval(viewFrom, viewFrom + viewSize)
    AudioFadingRenderer.render(context, range, config, {top: 10, bottom: 10 + height}, 0, end, "red")
    range.terminate()
    return {strokes, fills, handles, range}
}

it.each([1, 2])("bounds long offscreen fade paths by visible device pixels at DPR %s", dpr => {
    for (const width of [10_000, 100_000, 1_000_000]) {
        for (const direction of ["in", "out"] as const) {
            const config = {in: 0, out: 0, inSlope: 0.2, outSlope: 0.8, [direction]: width}
            const {strokes, fills} = render(config, width, width / 2, dpr)
            expect(strokes).toHaveLength(1)
            expect(strokes[0].lines).toBeLessThanOrEqual(200 * dpr + 2)
            expect(fills[0].lines).toBeLessThanOrEqual(200 * dpr + 4)
        }
    }
})

it.each([1, 2])("samples the original curve after clipping and zooming at DPR %s", dpr => {
    for (const [viewFrom, viewSize] of [[0, 200], [123.4, 333.3], [800, 200]]) {
        for (const direction of ["in", "out"] as const) {
            const config = {in: 0, out: 0, inSlope: 0.2, outSlope: 0.8, [direction]: 1000}
            const {strokes, fills, handles, range} = render(config, 1000, viewFrom, dpr, 100, viewSize)
            const x0 = range.unitToX(0) * dpr
            const x1 = range.unitToX(1000) * dpr
            const definition = {slope: config[direction === "in" ? "inSlope" : "outSlope"], steps: x1 - x0,
                y0: (direction === "in" ? 110 : 10) * dpr, y1: (direction === "in" ? 10 : 110) * dpr}
            expect(strokes[0].points.length).toBeGreaterThan(2)
            for (const [x, y] of strokes[0].points) {
                expect(x).toBeGreaterThanOrEqual(0)
                expect(x).toBeLessThanOrEqual(200 * dpr)
                expect(y).toBeCloseTo(Curve.valueAt(definition, x - x0), 8)
            }
            expect(strokes[0].points[0][0]).toBeCloseTo(0, 8)
            expect(strokes[0].points.at(-1)?.[0]).toBeCloseTo(200 * dpr, 8)
            expect(fills[0].points.every(([x]) => x >= 0 && x <= 200 * dpr)).toBe(true)
            expect(handles).toEqual([range.unitToX(config.in) * dpr, range.unitToX(1000 - config.out) * dpr])
        }
    }
})

it("skips hidden and boundary-touching fades", () => {
    const config = {in: 100, out: 100, inSlope: 0.2, outSlope: 0.8}
    for (const viewFrom of [100, 200, 300]) {
        expect(render(config, 1000, viewFrom).strokes).toEqual([])
    }
})

it("keeps scaled overlapping fades and zero-height bounds finite", () => {
    const config = {in: 800, out: 800, inSlope: 0.2, outSlope: 0.8}
    for (const height of [0, 100]) {
        const {strokes, range, handles} = render(config, 1000, 450, 2, height)
        expect(strokes).toHaveLength(2)
        for (const [index, stroke] of strokes.entries()) {
            const start = index === 0 ? 0 : 500
            const definition = {slope: index === 0 ? config.inSlope : config.outSlope,
                steps: (range.unitToX(start + 500) - range.unitToX(start)) * 2,
                y0: (index === 0 ? 10 + height : 10) * 2, y1: (index === 0 ? 10 : 10 + height) * 2}
            for (const [x, y] of stroke.points) {
                expect(y).toBeCloseTo(Curve.valueAt(definition, x - range.unitToX(start) * 2), 8)
            }
        }
        expect(handles).toEqual([range.unitToX(500) * 2, range.unitToX(500) * 2])
    }
})
