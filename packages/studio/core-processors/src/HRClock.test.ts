import {afterEach, expect, it, vi} from "vitest"
import {HRClock} from "./HRClock"

afterEach(() => {vi.restoreAllMocks()})
function fixture(start = 1, end = 2) {
    const sab = new SharedArrayBuffer(32), ints = new Int32Array(sab), times = new Float64Array(sab)
    const publish = (start: number, end: number, from: number, to: number) => {
        Atomics.add(ints, 3, 1)
        times[2] = from; times[3] = to
        Atomics.store(ints, 1, start); Atomics.store(ints, 2, end)
        Atomics.add(ints, 3, 1)
    }
    publish(start, end, 10, 13)
    return {clock: new HRClock(sab), ints, times, publish}
}
it("rejects publication between counter and timestamp reads without retrying the audio thread", () => {
    const {clock, publish} = fixture()
    const load = Atomics.load
    let intervened = false
    vi.spyOn(Atomics, "load").mockImplementation((array, index) => {
        const value = load(array, index)
        if (index === 2 && !intervened) {
            intervened = true
            publish(3, 2, 100, 13)
        }
        return value
    })
    expect(clock.start()).toBe(0)
    publish(3, 4, 100, 104)
    expect(clock.start()).toBe(0) // no elapsed from mixed timestamps and old counters
    expect(clock.start()).toBe(4)
})
it("refuses a publication in progress, then recovers on a complete pair", () => {
    const {clock, ints, times} = fixture()
    Atomics.add(ints, 3, 1); times[2] = 100
    clock.start(); expect(clock.start()).toBe(0)
    times[2] = 10; Atomics.add(ints, 3, 1)
    expect(clock.start()).toBe(0); expect(clock.start()).toBe(3)
})
it.each([[0x7fffffff, -0x80000000], [-3, -2], [-1, 0], [1, 2]])(
    "keeps consecutive modular counters %s -> %s", (start, end) => {
        const {clock} = fixture(start, end)
        expect(clock.start()).toBe(0); expect(clock.start()).toBe(3)
    })
it("rejects uninitialized and skipped pairs", () => {
    const clock = new HRClock(new SharedArrayBuffer(32))
    clock.start(); expect(clock.start()).toBe(0)
    const {clock: skipped} = fixture(1, 4)
    skipped.start(); expect(skipped.start()).toBe(0)
})
