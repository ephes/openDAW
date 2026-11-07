import {expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {StemSeparationTask} from "./StemSeparationTask"
import {TensorMap} from "../Tensor"
it("rejects cancellation during the final chunk without successful progress or stems", async () => {
    const controller = new AbortController()
    const reason = new Error("synthetic cancellation")
    let complete!: (value: TensorMap) => void
    const session = vi.fn(() => new Promise<TensorMap>(resolve => {complete = resolve}))
    const progress = vi.fn()
    const result = StemSeparationTask.run({audio: new Float32Array([1]), channels: 1, sampleRate: 44100}, {
        session, progress, signal: Option.wrap(controller.signal), inputNames: ["mix"], outputNames: ["out"]
    })
    controller.abort(reason)
    const window = Math.round(44100 * 7.8)
    complete({out: {type: "float32", dims: [1, 4, 1, window], data: new Float32Array(window * 4)}})
    await expect(result).rejects.toBe(reason)
    expect(progress).not.toHaveBeenCalled()
})
