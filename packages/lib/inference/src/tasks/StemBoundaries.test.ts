import {expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {planChunks, StemSeparationInput, StemSeparationTask} from "./StemSeparationTask"
import {TensorMap} from "../Tensor"
const window = Math.round(7.8 * 44100)
const env = (session = vi.fn()) => ({session, signal: Option.None, progress: vi.fn(), inputNames: ["mix"], outputNames: ["out"]})
for (const input of [
    {audio: new Float32Array(3), channels: 2, sampleRate: 44100},
    {audio: new Float32Array(0), channels: 0, sampleRate: 44100},
    {audio: new Float32Array(1), channels: 3, sampleRate: 44100},
    {audio: new Float32Array([NaN]), channels: 1, sampleRate: 44100},
    {audio: new Float32Array([Infinity]), channels: 1, sampleRate: 44100}
]) {
    it(`rejects invalid planar input ${input.channels}/${input.audio[0]}`, async () => {
        const context = env()
        await expect(StemSeparationTask.run(input as StemSeparationInput, context)).rejects.toThrow()
        expect(context.session).not.toHaveBeenCalled()
    })
}
for (const args of [[-1, 100, 0], [1, Infinity, 0], [NaN, 100, 0], [1, 100, -1], [1.5, 100, 0]]) {
    it(`rejects invalid planner arguments ${args}`, () => expect(() => planChunks(args[0], args[1], args[2])).toThrow())
}
for (const output of [
    {type: "int32", data: new Int32Array(4), dims: [1, 4, 1, window]},
    {type: "float32", data: new Float32Array(4), dims: [1, 4, 1, window]},
    {type: "float32", data: new Float32Array(window * 4), dims: [2, 4, 1, window]},
    {type: "float32", data: new Float32Array(window * 4), dims: [1, 4, 2, window / 2]}
]) {
    it(`rejects malformed stacked output ${output.type}/${output.dims}`, async () => {
        const session = vi.fn(async () => ({out: output} as TensorMap))
        await expect(StemSeparationTask.run({audio: new Float32Array([1]), channels: 1, sampleRate: 44100}, env(session))).rejects.toThrow(/stem output/)
    })
}
it("matches stacked and separate supported tensor layouts", async () => {
    const data = new Float32Array(window * 4)
    for (let stem = 0; stem < 4; stem++) {data.fill(stem + 1, stem * window, (stem + 1) * window)}
    const input = {audio: new Float32Array([1, 2]), channels: 1 as const, sampleRate: 44100}
    const stacked = await StemSeparationTask.run(input, env(vi.fn(async () => ({out: {type: "float32" as const, dims: [1, 4, 1, window], data}}))))
    const names = ["drums", "bass", "other", "vocals"] as const
    const outputs = Object.fromEntries(names.map((name, index) => [name, {type: "float32", dims: [1, 1, window], data: data.slice(index * window, (index + 1) * window)}])) as TensorMap
    const separate = await StemSeparationTask.run(input, {...env(vi.fn(async () => outputs)), outputNames: names})
    for (const name of names) {expect(stacked[name]).toEqual(separate[name]); expect(stacked[name].length).toBe(2)}
})
it("accepts empty audio without session work", async () => {
    const context = env()
    const result = await StemSeparationTask.run({audio: new Float32Array(), channels: 1, sampleRate: 44100}, context)
    expect(result.drums.length).toBe(0)
    expect(context.session).not.toHaveBeenCalled()
})

for (const invalid of [
    {type: "int32", data: new Int32Array(window), dims: [1, 1, window]},
    {type: "float32", data: new Float32Array(window), dims: [1, window]},
    {type: "float32", data: new Float32Array(window), dims: [1, 2, window / 2]}
]) {
    it(`rejects malformed separate output ${invalid.type}/${invalid.dims}`, async () => {
        const names = ["drums", "bass", "other", "vocals"]
        const outputs = Object.fromEntries(names.map(name => [name, invalid])) as TensorMap
        const context = {...env(vi.fn(async () => outputs)), outputNames: names}
        await expect(StemSeparationTask.run({audio: new Float32Array([1]), channels: 1, sampleRate: 44100}, context)).rejects.toThrow(/stem output/)
    })
}
