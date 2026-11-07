import {describe, expect, it} from "vitest"
import {Ramp} from "./ramp"

const behavior = <T>(name: string, create: () => Ramp<T>, value: (amount: number) => T) => {
    describe(name, () => {
        it("keeps settled smooth sets idle", () => {
            const ramp = create()
            ramp.set(value(0), true)
            expect(ramp.isInterpolating()).toBe(false)
            ramp.set(value(1), false)
            ramp.set(value(1), true)
            expect(ramp.isFixed(value(1))).toBe(true)
        })
        it("cancels a pending target by immediately setting the current value", () => {
            const ramp = create()
            ramp.set(value(1), true)
            expect(ramp.moveAndGet()).toEqual(value(0.25))
            ramp.set(value(0.25), false)
            expect(ramp.isInterpolating()).toBe(false)
            expect(ramp.isFixed(value(0.25))).toBe(true)
            for (let index = 0; index < 8; index++) {expect(ramp.moveAndGet()).toEqual(value(0.25))}
        })
        it("smoothly retargets from the current value and settles exactly", () => {
            const ramp = create()
            ramp.set(value(1), true)
            ramp.moveAndGet()
            ramp.set(value(0), true)
            for (const amount of [0.1875, 0.125, 0.0625, 0]) {expect(ramp.moveAndGet()).toEqual(value(amount))}
            expect(ramp.isFixed(value(0))).toBe(true)
            ramp.set(value(1), true)
            for (let index = 0; index < 4; index++) {ramp.moveAndGet()}
            expect(ramp.get()).toEqual(value(1))
            expect(ramp.isInterpolating()).toBe(false)
        })
    })
}
behavior("linear ramp", () => Ramp.linear(1000, 0.004), amount => amount)
behavior("matrix ramp", () => Ramp.stereoMatrix(1000, 0.004), amount => ({ll: amount, lr: amount * 2, rl: amount * 3, rr: amount * 4}))
