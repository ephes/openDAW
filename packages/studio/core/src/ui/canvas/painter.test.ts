import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {AnimationFrame, Html} from "@opendaw/lib-dom"
import {CanvasPainter} from "./painter"

const frames = new Set<() => void>()
let resize: () => void
const owners: CanvasPainter[] = []
beforeEach(() => {
    vi.stubGlobal("devicePixelRatio", 1)
    vi.spyOn(AnimationFrame, "add").mockImplementation(callback => {
        frames.add(callback); return {terminate: () => {frames.delete(callback)}}
    })
    vi.spyOn(Html, "watchResize").mockImplementation((_, callback) => {
        resize = () => callback({} as ResizeObserverEntry, {} as ResizeObserver); return {terminate() {}}
    })
})
afterEach(() => {owners.splice(0).forEach(p => p.terminate()); frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
const frame = () => [...frames].forEach(callback => callback())
const fixture = (draw: (p: CanvasPainter) => void) => {
    const canvas = document.createElement("canvas")
    Object.defineProperties(canvas, {clientWidth: {value: 100, configurable: true}, clientHeight: {value: 50}})
    vi.spyOn(canvas, "getContext").mockReturnValue({canvas} as unknown as CanvasRenderingContext2D)
    const painter = new CanvasPainter(canvas, draw)
    owners.push(painter)
    return {canvas, painter}
}
it("preserves reentrant requests, including a resize render, then returns to idle", () => {
    const draw = vi.fn((p: CanvasPainter) => {
        if (draw.mock.calls.length === 1 || p.isResized) {p.requestUpdate(); p.requestUpdate()}
    })
    const {canvas} = fixture(draw)
    frame(); frame(); frame()
    expect(draw).toHaveBeenCalledTimes(2)
    Object.defineProperty(canvas, "clientWidth", {value: 120}); resize()
    frame(); frame(); frame()
    expect(draw).toHaveBeenCalledTimes(4)
})
it("retires a request made during a draw", () => {
    const draw = vi.fn((p: CanvasPainter) => {p.requestUpdate(); p.terminate()})
    fixture(draw); frame(); frame()
    expect(draw).toHaveBeenCalledTimes(1)
})
it("redraws once on a DPR-only change and preserves hidden-canvas pending work", () => {
    const draw = vi.fn()
    const {canvas} = fixture(draw)
    frame(); frame(); expect(draw).toHaveBeenCalledTimes(1)
    vi.stubGlobal("devicePixelRatio", 2)
    Object.defineProperty(canvas, "clientWidth", {value: 0})
    frame(); expect(draw).toHaveBeenCalledTimes(1)
    Object.defineProperty(canvas, "clientWidth", {value: 100})
    frame(); frame()
    expect(canvas.width).toBe(200); expect(canvas.height).toBe(100)
    expect(draw).toHaveBeenCalledTimes(2)
})
