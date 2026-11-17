import {AnimationFrame} from "@opendaw/lib-dom"
import {RevampDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {createCurveRenderer, plotSpectrum} from "@/ui/devices/audio-effects/Revamp/Renderer"
import {xAxis, yAxis} from "@/ui/devices/audio-effects/Revamp/constants"
import {LinearScale} from "@opendaw/studio-core"

const NativePath = Path2D
class RecordedPath extends NativePath {
    readonly points: number[][] = []
    moveTo(x: number, y: number): void {this.points.push([x, y]); super.moveTo(x, y)}
    lineTo(x: number, y: number): void {this.points.push([x, y]); super.lineTo(x, y)}
}
// Keep native canvas rendering; record the coordinates actually submitted to it.
globalThis.Path2D = RecordedPath
AnimationFrame.start(window)
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
function canvasFixture(width: number) {
    const canvas = document.createElement("canvas")
    canvas.style.cssText = `width:${width}px;height:200px`
    document.body.append(canvas)
    const context = canvas.getContext("2d")!
    const paths: RecordedPath[] = []
    const stroke = context.stroke.bind(context)
    context.stroke = ((path: RecordedPath) => {paths.push(path); stroke(path)}) as typeof context.stroke
    return {canvas, context, paths}
}
export async function response(rate: number, band: "highBell" | "lowPass") {
    // Processor modules read the AudioWorkletGlobalScope `sampleRate` in static initializers,
    // so define it before loading them on the window.
    Object.assign(globalThis, {sampleRate: rate})
    const {RevampDeviceProcessor} = await import("@processors/devices/audio-effects/RevampDeviceProcessor")
    const {processorFixture, block} = await import("@processors/devices/processor-test-fixture")
    const f = processorFixture()
    const field = (value: number | boolean) => {
        const p = f.field(value)
        return Object.assign(p, {getControlledValue: () => p.getValue()})
    }
    const namedParameter = Object.fromEntries(["highPass", "lowShelf", "lowBell", "midBell", "highBell", "highShelf", "lowPass"].map(name =>
        [name, {enabled: field(name === band), frequency: field(18000), q: field(10), gain: field(18), order: field(1)}]))
    const adapter = {address: f.address, uuid: f.address.uuid, spectrum: f.address.append(9), namedParameter} as unknown as RevampDeviceBoxAdapter
    const processor = new RevampDeviceProcessor(f.context, adapter)
    processor.setAudioSource(f.input)
    const impulse: number[] = []
    f.input.getChannel(0)[0] = 1
    for (let q = 0; q < 64; q++) {
        processor.processAudio(block())
        impulse.push(...processor.audioOutput.getChannel(0))
        f.input.clear()
    }
    const {canvas, paths} = canvasFixture(1024)
    const renderer = createCurveRenderer(canvas, xAxis, yAxis, adapter, rate)
    for (let i = 0; i < 4; i++) await frame()
    // The first stroke of each frame is the enabled band's unrounded dB curve.
    const points = paths[paths.length - 2].points
    const samples = [0.7, 0.85, 0.94, 0.97, 0.985, 1].map(norm => {
        const x = Math.round(norm * (canvas.width - 1))
        const hz = xAxis.normToUnit(x / (canvas.width - 1))
        let real = 0, imag = 0
        impulse.forEach((value, n) => {
            real += value * Math.cos(2 * Math.PI * hz / rate * n)
            imag -= value * Math.sin(2 * Math.PI * hz / rate * n)
        })
        return {hz, plotted: yAxis.normToUnit(1 - points[x][1] / canvas.height),
            actual: 20 * Math.log10(Math.hypot(real, imag))}
    })
    renderer.terminate(); processor.terminate(); canvas.remove()
    return samples
}

export async function spectrumGeometry() {
    const {canvas, context, paths} = canvasFixture(100)
    const scale = new LinearScale(-60, -3)
    const results: {width: number, peak: boolean, finite: boolean, minY: number, maxY: number, pixels: boolean}[] = []
    for (const width of [0, 1, 100, 0, 100]) for (const peak of [false, true, false]) {
        canvas.style.width = `${width}px`
        const spectrum = new Float32Array(512)
        if (peak) spectrum[32] = 0.5
        paths.length = 0
        plotSpectrum(context, xAxis, scale, spectrum, 48000)
        const points = paths.flatMap(path => path.points)
        const ys = points.map(point => point[1])
        results.push({width, peak, finite: points.flat().every(Number.isFinite),
            minY: ys.length ? Math.min(...ys) : 0, maxY: ys.length ? Math.max(...ys) : 0,
            pixels: width > 0 && context.getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)})
    }
    canvas.remove()
    return results
}
