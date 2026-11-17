import {expect, it} from "vitest"
import {Curve} from "./curve"

it.each([0, 0.2, 0.5, 0.8, 1])("keeps constant recurrences exact at slope %s", slope => {
    for (const value of [0, 120, -3]) {
        expect(Curve.coefficients({slope, steps: 64, y0: value, y1: value})).toEqual({m: 1, q: 0})
        expect([...Curve.walk(slope, 64, value, value)]).toEqual(Array(64).fill(value))
        const rendered: number[] = []
        Curve.run(slope, 64, value, value, sample => rendered.push(sample))
        expect(rendered).toEqual(Array(64).fill(value))
    }
})

it.each([0.2, 0.5, 0.8])("retains changing curve samples at slope %s", slope => {
    const definition = {slope, steps: 64, y0: 90, y1: 180}
    const samples = [...Curve.walk(slope, definition.steps, definition.y0, definition.y1)]
    samples.forEach((value, index) => expect(value).toBeCloseTo(Curve.valueAt(definition, index + 1), 8))
})
