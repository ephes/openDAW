// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest"
import {HRClockWorker} from "./HRClockWorker"

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
it("publishes each timestamp and response counter under an odd/even sequence", async () => {
    let blob: Blob | undefined
    vi.spyOn(URL, "createObjectURL").mockImplementation(value => {blob = value as Blob; return "blob:synthetic"})
    vi.stubGlobal("Worker", class {postMessage() {}})
    const worker = HRClockWorker.get(), ints = new Int32Array(worker.sab), times = new Float64Array(worker.sab)
    const done = new Error("synthetic worker stopped")
    let waits = 0, ticks = 0
    const atomics = {load: Atomics.load, store: Atomics.store, add: Atomics.add,
        wait: () => {
            if (++waits > 2) throw done
            Atomics.store(ints, 0, waits)
        }}
    const performance = {now: () => {
        expect(Atomics.load(ints, 3) & 1).toBe(1)
        return ++ticks === 1 ? 10 : 13
    }}
    const run = new Function("Atomics", "performance", "onmessage", `${await blob!.text()}; return onmessage`)(atomics, performance)
    expect(() => run({data: worker.sab})).toThrow(done)
    expect(Array.from(ints.slice(1, 4))).toEqual([1, 2, 4])
    expect(Array.from(times.slice(2))).toEqual([10, 13])
})
