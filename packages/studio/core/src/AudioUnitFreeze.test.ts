import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {AudioData} from "@opendaw/lib-dsp"
import {Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import {AudioUnitFreeze} from "./AudioUnitFreeze"
import {OfflineEngineRenderer} from "./OfflineEngineRenderer"
import type {Project} from "./project"

vi.mock("./OfflineEngineRenderer", () => ({OfflineEngineRenderer: {start: vi.fn()}}))
const fixture = () => {
    let bpm = () => {}
    let tempo = () => {}
    const subscription = {terminate: vi.fn()}
    const copied = {terminate: vi.fn()}
    const unit = {uuid: UUID.generate(), labeledAudioOutputs: () => [], tracks: new Map(),
        box: {subscribeDeletion: vi.fn(() => subscription)}}
    const project = {
        timelineBoxAdapter: {
            box: {bpm: {subscribe: (callback: () => void) => {bpm = callback; return subscription}}},
            catchupAndSubscribeTempoAutomation: (callback: () => void) => {tempo = callback; return subscription}
        },
        engine: {sampleRate: 48000, setFrozenAudio: vi.fn()}, copy: vi.fn(() => copied),
        regionSelection: {selected: () => [], deselect: vi.fn()},
        userEditingManager: {timeline: {get: () => Option.None}},
        captureDevices: {get: () => Option.None}
    }
    const manager = new AudioUnitFreeze(project as unknown as Project)
    const gate = Promise.withResolvers<AudioData>()
    vi.mocked(OfflineEngineRenderer.start).mockReturnValueOnce(gate.promise)
    const run = () => manager.freeze(unit as unknown as AudioUnitBoxAdapter)
    return {manager, project, unit, copied, gate, run, bpm: () => bpm(), tempo: () => tempo()}
}
beforeEach(() => {
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate: vi.fn()} as never)
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined as never)
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})

it("coalesces concurrent requests and owns one deletion subscription", async () => {
    const f = fixture()
    const a = f.run(), b = f.run()
    expect(a).toBe(b)
    f.gate.resolve(AudioData.create(48000, 2, 8))
    await Promise.all([a, b])
    expect(OfflineEngineRenderer.start).toHaveBeenCalledTimes(1)
    expect(f.unit.box.subscribeDeletion).toHaveBeenCalledTimes(1)
    await f.run()
    expect(OfflineEngineRenderer.start).toHaveBeenCalledTimes(1)
})
it("retires failed pending work so retry can render", async () => {
    const f = fixture()
    const a = f.run()
    f.gate.reject(new Error("synthetic"))
    await a
    vi.mocked(OfflineEngineRenderer.start).mockResolvedValueOnce(AudioData.create(48000, 2, 8))
    await f.run()
    expect(OfflineEngineRenderer.start).toHaveBeenCalledTimes(2)
    expect(f.project.engine.setFrozenAudio).toHaveBeenCalledTimes(1)
})
it.each(["bpm", "tempo"] as const)("discards a render invalidated by %s", async kind => {
    const f = fixture()
    const a = f.run()
    await vi.waitFor(() => expect(OfflineEngineRenderer.start).toHaveBeenCalled())
    f[kind]()
    f.gate.resolve(AudioData.create(48000, 2, 8))
    await a
    expect(f.project.engine.setFrozenAudio).not.toHaveBeenCalled()
    expect(f.unit.box.subscribeDeletion).not.toHaveBeenCalled()
})
it("starts a current-generation request while a stale render is pending", async () => {
    const f = fixture()
    const old = f.run()
    await vi.waitFor(() => expect(OfflineEngineRenderer.start).toHaveBeenCalledTimes(1))
    f.bpm()
    const nextGate = Promise.withResolvers<AudioData>()
    vi.mocked(OfflineEngineRenderer.start).mockReturnValueOnce(nextGate.promise)
    const next = f.run()
    await vi.waitFor(() => expect(OfflineEngineRenderer.start).toHaveBeenCalledTimes(2))
    f.gate.resolve(AudioData.create(48000, 8, 2))
    await old
    expect(f.run()).toBe(next)
    expect(f.project.engine.setFrozenAudio).not.toHaveBeenCalled()
    nextGate.resolve(AudioData.create(48000, 8, 2))
    await next
    expect(f.project.engine.setFrozenAudio).toHaveBeenCalledTimes(1)
})
