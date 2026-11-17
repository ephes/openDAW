// Independent zero-insertion/convolution oracle; Float32 storage matches stage boundaries.
export const halfband = new Float32Array([
    -0.00048076361, 0, 0.00174689293, 0, -0.00421638042, 0, 0.00854519755, 0,
    -0.01627072692, 0, 0.03203375191, 0, -0.08251235634, 0, 0.31203505397, 0.5,
    0.31203505397, 0, -0.08251235634, 0, 0.03203375191, 0, -0.01627072692, 0,
    0.00854519755, 0, -0.00421638042, 0, 0.00174689293, 0, -0.00048076361
])
export function fir(input: Float32Array): Float32Array {
    return Float32Array.from(input, (_, n) => {
        let sum = 0
        for (let k = 0; k < halfband.length && k <= n; k++) sum += halfband[k] * input[n - k]
        return sum
    })
}
export function upsampleReference(input: Float32Array, factor: number): Float32Array {
    if (factor === 1) return input
    const inserted = new Float32Array(input.length * 2)
    input.forEach((value, i) => inserted[i * 2] = value)
    return upsampleReference(fir(inserted).map(value => value * 2), factor / 2)
}
export function downsampleReference(input: Float32Array, factor: number): Float32Array {
    if (factor === 1) return input
    const filtered = fir(input)
    return downsampleReference(Float32Array.from({length: input.length / 2}, (_, i) => filtered[i * 2 + 1]), factor / 2)
}
