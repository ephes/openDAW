import {expect, it, vi} from "vitest"
import {DefaultObservableValue} from "@opendaw/lib-std"
import {Delay} from "./delay"
import {FrequencyDomainConvolver} from "./frequency-domain-convolver"
import {ConstantTempoMap} from "./ConstantTempoMap"

const delayOracle = (source: Float32Array, offset: number) => Array.from(source, (_, i) => {
    const index = i - offset, low = Math.floor(index), alpha = index - low
    return (source[low] ?? 0) * (1 - alpha) + (source[low + 1] ?? 0) * alpha
})
for (const offset of [0, 0.5, 1, 1.5]) {
    it(`matches a fractional delay oracle for ${offset} frames across wraps/splits/clear`, () => {
        const delay = new Delay(8, 4)
        delay.offset = offset
        const source = new Float32Array(37)
        for (const index of [0, 7, 8, 15, 25]) {source[index] = 1}
        const expected = delayOracle(source, offset)
        for (const splits of [[37], [1, 3, 8, 9, 16, 29, 37]]) {
            delay.clear()
            const target = source.slice() // in-place must retain the same integer/fractional result
            let from = 0
            for (const to of splits) {delay.process(target, target, from, to); from = to}
            expect(Array.from(target)).toEqual(expected)
        }
    })
}
it("keeps fractional interpolation after smoothing settles", () => {
    const delay = new Delay(16, 4)
    delay.process(new Float32Array(4), new Float32Array(4), 0, 4)
    delay.offset = 1.5
    delay.process(new Float32Array(8), new Float32Array(8), 0, 8)
    const source = new Float32Array([1, 0, 0, 0, 0]), target = new Float32Array(5)
    delay.process(target, source, 0, 5)
    expect(Array.from(target)).toEqual(delayOracle(source, 1.5))
})
for (const blockSize of [1, 2, 4, 7, 16]) {
    it(`aligns convolution exactly to declared latency ${blockSize}`, () => {
        const convolver = new FrequencyDomainConvolver(8, blockSize)
        convolver.setImpulseResponse(new Float32Array([1]))
        const source = new Float32Array(2 * blockSize + 8); source[0] = 1
        const target = new Float32Array(source.length)
        convolver.process(source, target, 0, source.length)
        for (let i = 0; i < target.length; i++) {expect(target[i]).toBeCloseTo(i === convolver.latency ? 1 : 0, 5)}
    })
    it(`matches asymmetric direct convolution across arbitrary splits at block size ${blockSize}`, () => {
        const kernel = new Float32Array([0.5, -0.25, 0.125, 0.75, -0.5])
        const convolver = new FrequencyDomainConvolver(kernel.length, blockSize)
        convolver.setImpulseResponse(kernel)
        const source = new Float32Array(64)
        source.set([1, -0.25, 0.5, 0, -0.75, 0.125])
        const expected = Array.from(source, (_, i) => kernel.reduce((sum, k, j) => sum + k * (source[i - convolver.latency - j] ?? 0), 0))
        for (const splits of [[64], [1, 3, 6, 11, 29, 31, 60, 64]]) {
            convolver.clear()
            const target = source.slice()
            let from = 0
            for (const to of splits) {convolver.process(target, target, from, to); from = to}
            target.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5))
        }
    })
}
it("releases the real tempo source subscription exactly once", () => {
    const source = new DefaultObservableValue(120)
    const subscribe = source.subscribe.bind(source)
    let active = 0
    vi.spyOn(source, "subscribe").mockImplementation(observer => {
        active++
        const sub = subscribe(observer)
        return {terminate: () => {active--; sub.terminate()}}
    })
    const map = new ConstantTempoMap(source)
    const notify = vi.fn()
    map.subscribe(notify)
    expect(active).toBe(1)
    source.setValue(90)
    expect(map.getTempoAt(0)).toBe(90)
    map.terminate(); map.terminate()
    expect(active).toBe(0)
    source.setValue(60)
    expect(map.getTempoAt(0)).toBe(90)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
})
