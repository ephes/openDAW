import {int, panic, Procedure, unitValue} from "./lang"
import {Arrays} from "./arrays"

export namespace Progress {
    export type Handler = Procedure<unitValue>

    export const Empty: Handler = Object.freeze(_ => {})

    export const split = (progress: Handler, count: int): ReadonlyArray<Handler> => {
        const collect = new Float64Array(count)
        let total = 0
        return Arrays.create(index => (value: number) => {
            total += value - collect[index]
            collect[index] = value
            progress(total / count)
        }, count)
    }

    export const splitWithWeights = (progress: Handler, weights: ReadonlyArray<number>): ReadonlyArray<Handler> => {
        const count = weights.length
        const collect = new Float64Array(count)
        if (weights.length === 0) {return panic("Weights must not be empty")}
        if (weights.some(weight => !Number.isFinite(weight) || weight <= 0)) {
            return panic("Weights must be finite and greater than zero")
        }
        const maximum = weights.reduce((maximum, weight) => Math.max(maximum, weight), 0)
        const scaledWeights = weights.map(weight => weight / maximum)
        const weightSum = scaledWeights.reduce((sum, weight) => sum + weight, 0)
        const normalizedWeights = scaledWeights.map(weight => weight / weightSum)
        let total = 0
        return Arrays.create(index => (value: number) => {
            total += (value - collect[index]) * normalizedWeights[index]
            collect[index] = value
            progress(total)
        }, count)
    }
}
