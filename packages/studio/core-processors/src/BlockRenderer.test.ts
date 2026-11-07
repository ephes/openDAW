import {beforeAll, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {EngineContext} from "./EngineContext"
import {Block} from "./processing"
import {TimeInfo} from "./TimeInfo"
import {BlockRenderer} from "./BlockRenderer"
beforeAll(() => {Object.assign(globalThis, {sampleRate: 1920})})
function fixture(loop = false) {
    const listeners = [new Set<() => void>(), new Set<() => void>(), new Set<() => void>()]
    const disposals = [0, 0, 0]
    const subscribe = (index: number, callback: () => void) => {
        listeners[index].add(callback)
        return {terminate: () => {if (listeners[index].delete(callback)) disposals[index]++}}
    }
    const timeInfo = new TimeInfo(); timeInfo.transporting = true
    const context = {timeInfo, timelineBoxAdapter: {
        box: {bpm: {getValue: () => 120, subscribe: (cb: () => void) => subscribe(0, cb)},
            loopArea: {from: {getValue: () => 0}, to: {getValue: () => loop ? 64 : 10000}, enabled: {getValue: () => loop}}},
        markerTrack: {enabled: false, events: {lowerEqual: () => null}, subscribe: (cb: () => void) => subscribe(1, cb)},
        catchupAndSubscribeTempoAutomation: (cb: (option: Option<never>) => void) => {
            cb(Option.None); return subscribe(2, () => cb(Option.None))
        }
    }, preferences: {settings: {playback: {pauseOnLoopDisabled: false}, recording: {allowTakes: false}}},
        engineToClient: {switchMarkerState: vi.fn()}} as unknown as EngineContext
    return {context, timeInfo, listeners, disposals}
}
it("owns start/interior boundaries once, permits cancellation and callback mutation, and covers every sample", () => {
    const f = fixture(), r = new BlockRenderer(f.context), calls: string[] = []
    r.setCallback(0, () => calls.push("start"))
    const removed = r.setCallback(64, () => calls.push("removed")); removed.terminate()
    r.setCallback(64, () => {calls.push("interior"); second.terminate(); r.setCallback(96, () => calls.push("added"))})
    const second = r.setCallback(64, () => calls.push("cancelled-peer"))
    r.setCallback(128, () => calls.push("boundary"))
    r.setCallback(256, () => calls.push("end"))
    const blocks: Block[][] = []
    for (let i = 0; i < 3; i++) r.process(info => blocks.push([...info.blocks]))
    expect(calls).toEqual(["start", "interior", "added", "boundary", "end"])
    blocks.forEach(render => {
        const coverage = new Uint8Array(128)
        render.forEach(b => {for (let i = b.s0; i < b.s1; i++) coverage[i]++})
        expect(Array.from(coverage)).toEqual(Array(128).fill(1))
    })
})
it("owns all three subscriptions through idempotent renderer teardown", () => {
    const f = fixture()
    for (let i = 0; i < 3; i++) {
        const r = new BlockRenderer(f.context)
        expect(f.listeners.map(s => s.size)).toEqual([1, 1, 1])
        r.terminate(); r.terminate()
        expect(f.listeners.map(s => s.size)).toEqual([0, 0, 0])
        f.listeners[1].forEach(cb => cb())
    }
    expect(f.disposals).toEqual([3, 3, 3])
})
it("defers same-position additions until a later visit without a zero-progress loop", () => {
    const f = fixture(), r = new BlockRenderer(f.context), calls: string[] = []
    const first = r.setCallback(0, () => {calls.push("first"); first.terminate(); r.setCallback(0, () => calls.push("added"))})
    r.process(() => {}); expect(calls).toEqual(["first"])
    f.timeInfo.position = 0
    r.process(() => {}); expect(calls).toEqual(["first", "added"])
})

it("dispatches a persistent callback again on the next loop traversal", () => {
    const f = fixture(true), r = new BlockRenderer(f.context), callback = vi.fn()
    r.setCallback(32, callback)
    r.process(() => {})
    expect(callback).toHaveBeenCalledTimes(2)
})
