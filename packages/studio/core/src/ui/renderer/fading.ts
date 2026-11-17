import {Curve, TAU} from "@opendaw/lib-std"
import {FadingEnvelope} from "@opendaw/lib-dsp"
import {TimelineRange} from "../../index"
import {RegionBound} from "./env"

export namespace AudioFadingRenderer {
    export const render = (context: CanvasRenderingContext2D,
                           range: TimelineRange,
                           fading: FadingEnvelope.Config,
                           {top, bottom}: RegionBound,
                           startPPQN: number,
                           endPPQN: number,
                           color: string): void => {
        const dpr = devicePixelRatio
        const actualTop = top * dpr
        const actualBottom = bottom * dpr
        const {inSlope: fadeInSlope, outSlope: fadeOutSlope} = fading
        const duration = endPPQN - startPPQN
        const totalFading = fading.in + fading.out
        const scale = totalFading > duration ? duration / totalFading : 1.0
        const fadeIn = fading.in * scale
        const fadeOut = fading.out * scale
        context.strokeStyle = color
        context.fillStyle = "rgba(0,0,0,0.25)"
        context.lineWidth = dpr
        const renderFade = (slope: number, x0: number, x1: number, y0: number, y1: number): void => {
            const visibleStart = Math.max(0, x0)
            const visibleEnd = Math.min(range.width * dpr, x1)
            if (visibleEnd <= visibleStart) {return}
            const definition = {slope, steps: x1 - x0, y0, y1}
            const yAt = (x: number): number => Curve.valueAt(definition, x - x0)
            const path = new Path2D()
            path.moveTo(visibleStart, yAt(visibleStart))
            for (let x = visibleStart + 1; x < visibleEnd; x++) {path.lineTo(x, yAt(x))}
            path.lineTo(visibleEnd, yAt(visibleEnd))
            context.stroke(path)
            path.lineTo(visibleEnd, actualTop)
            path.lineTo(visibleStart, actualTop)
            path.lineTo(visibleStart, yAt(visibleStart))
            context.fill(path)
        }
        if (fadeIn > 0) {
            const fadeInEndPPQN = startPPQN + fadeIn
            const x0 = range.unitToX(startPPQN) * dpr
            const x1 = range.unitToX(fadeInEndPPQN) * dpr
            renderFade(fadeInSlope, x0, x1, actualBottom, actualTop)
        }
        if (fadeOut > 0) {
            const x0 = range.unitToX(endPPQN - fadeOut) * dpr
            const x1 = range.unitToX(endPPQN) * dpr
            renderFade(fadeOutSlope, x0, x1, actualTop, actualBottom)
        }
        const handleRadius = 1.5 * dpr
        const x0 = Math.max(range.unitToX(startPPQN + fadeIn), range.unitToX(startPPQN)) * dpr
        const x1 = Math.min(range.unitToX(endPPQN - fadeOut), range.unitToX(endPPQN)) * dpr
        context.fillStyle = color
        context.beginPath()
        context.arc(x0, actualTop, handleRadius, 0, TAU)
        context.fill()
        context.beginPath()
        context.arc(x1, actualTop, handleRadius, 0, TAU)
        context.fill()
    }
}
