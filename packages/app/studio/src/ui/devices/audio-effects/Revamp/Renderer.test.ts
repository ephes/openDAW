import {afterEach, expect, it, vi} from "vitest"
import {BiquadCoeff} from "@opendaw/lib-dsp"
import {DefaultObservableValue, Terminable} from "@opendaw/lib-std"
import {RevampDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {CanvasUnitPainter, LinearScale} from "@opendaw/studio-core"
import {createCurveRenderer, plotSpectrum} from "./Renderer"
import {xAxis, yAxis} from "./constants"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
const state = vi.hoisted(() => ({draw: null as ((painter: CanvasUnitPainter) => void) | null}))
vi.mock("@opendaw/studio-core", async importOriginal => ({
    ...await importOriginal<typeof import("@opendaw/studio-core")>(),
    // Only scheduling/geometry is synthetic; curve creation and DSP remain real.
    CanvasUnitPainter: class {
        constructor(_canvas: HTMLCanvasElement, _x: unknown, _y: unknown, draw: (painter: CanvasUnitPainter) => void) {state.draw = draw}
        requestUpdate(): void {}
        terminate(): void {}
    }
}))
class PathSpy {
    readonly points: number[][] = []
    moveTo(x: number, y: number): void {this.points.push([x, y])}
    lineTo(x: number, y: number): void {this.points.push([x, y])}
    addPath(path: PathSpy): void {this.points.push(...path.points)}
    closePath(): void {}
}
afterEach(() => vi.unstubAllGlobals())
function contextFixture(width: number) {
    vi.stubGlobal("Path2D", PathSpy)
    vi.stubGlobal("devicePixelRatio", 1)
    const canvas = {width, height: 200, clientWidth: width, clientHeight: 200} as HTMLCanvasElement
    const context = {canvas, stroke: vi.fn<(path: PathSpy) => void>(), fill: vi.fn<(path: PathSpy) => void>(), createLinearGradient: () => ({addColorStop() {}})}
    const painter = {context, actualWidth: width, actualHeight: 200, isResized: true,
        unitToY: (db: number) => (1 - yAxis.unitToNorm(db)) * 200} as unknown as CanvasUnitPainter
    return {canvas, context, painter}
}
function adapterFixture(active: string) {
    const field = (value: number | boolean) => {
        const p = new DefaultObservableValue(value)
        return Object.assign(p, {getControlledValue: () => p.getValue()})
    }
    return {namedParameter: Object.fromEntries(["highPass", "lowShelf", "lowBell", "midBell", "highBell", "highShelf", "lowPass"].map(name =>
        [name, {enabled: field(name === active), frequency: field(18000), q: field(10), gain: field(18), order: field(1)}]))} as unknown as RevampDeviceBoxAdapter
}
function responseDb(coeff: BiquadCoeff, frequency: number) {
    const w = 2 * Math.PI * frequency
    const nr = coeff.b0 + coeff.b1 * Math.cos(w) + coeff.b2 * Math.cos(2 * w)
    const ni = -coeff.b1 * Math.sin(w) - coeff.b2 * Math.sin(2 * w)
    const dr = 1 + coeff.a1 * Math.cos(w) + coeff.a2 * Math.cos(2 * w)
    const di = -coeff.a1 * Math.sin(w) - coeff.a2 * Math.sin(2 * w)
    return 20 * Math.log10(Math.hypot(nr, ni) / Math.hypot(dr, di))
}
it.each([44100, 48000, 96000])("plots actual engine-rate coefficients at %i Hz", rate => {
    for (const active of ["highBell", "lowPass"]) {
        const f = contextFixture(1024)
        const renderer = createCurveRenderer(f.canvas, xAxis, yAxis, adapterFixture(active), rate)
        state.draw!(f.painter)
        const path = f.context.stroke.mock.calls[0][0] as PathSpy
        const coeff = new BiquadCoeff()
        if (active === "highBell") coeff.setPeakingParams(18000 / rate, 10, 18)
        else coeff.setLowpassParams(18000 / rate, 10)
        for (const x of [700, 850, 940, 970, 1000, 1023]) {
            const frequency = Math.fround(xAxis.normToUnit(x / 1023) / rate)
            const expected = responseDb(coeff, frequency) * (active === "lowPass" ? 2 : 1)
            expect(yAxis.normToUnit(1 - path.points[x][1] / 200)).toBeCloseTo(expected, 4)
        }
        renderer.terminate()
    }
})
it("spectrum paths remain finite at silence and mixed zero/peak bins through resizes", () => {
    for (const width of [0, 1, 100, 0, 100]) for (const peak of [false, true, false]) {
        const {context} = contextFixture(width)
        const spectrum = new Float32Array(512)
        if (peak) spectrum[32] = 0.5
        plotSpectrum(context as unknown as CanvasRenderingContext2D, xAxis, new LinearScale(-60, -3), spectrum, 48000)
        const points = context.stroke.mock.calls.flatMap(call => (call[0] as PathSpy).points)
        expect(points.flat().every(Number.isFinite)).toBe(true)
        if (width > 0) {
            const ys = points.map(point => point[1])
            expect(Math.max(...ys)).toBeLessThanOrEqual(200)
            expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
            if (!peak) expect(Math.min(...ys)).toBe(200)
            if (width > 1 && peak) expect(Math.min(...ys)).toBeLessThan(100)
        }
    }
})
it("curve paths stay finite for zero/one-pixel geometry and recover after resize", () => {
    const owned: Terminable[] = []
    for (const width of [0, 1, 100]) {
        const f = contextFixture(width)
        owned.push(createCurveRenderer(f.canvas, xAxis, yAxis, adapterFixture("highBell"), 48000))
        state.draw!(f.painter)
        const points = f.context.stroke.mock.calls.flatMap(call => (call[0] as PathSpy).points)
        expect(points.flat().every(Number.isFinite)).toBe(true)
        if (width > 1) expect(points.length).toBeGreaterThan(100)
    }
    owned.forEach(owner => owner.terminate())
})
