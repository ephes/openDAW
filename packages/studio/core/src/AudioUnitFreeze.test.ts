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
    expect(vi.mocked(OfflineEngineRenderer.start).mock.calls[0][3]?.aborted).toBe(true)
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
    expect(vi.mocked(OfflineEngineRenderer.start).mock.calls[1][3]?.aborted).toBe(false)
    f.gate.resolve(AudioData.create(48000, 8, 2))
    await old
    expect(f.run()).toBe(next)
    expect(f.project.engine.setFrozenAudio).not.toHaveBeenCalled()
    nextGate.resolve(AudioData.create(48000, 8, 2))
    await next
    expect(f.project.engine.setFrozenAudio).toHaveBeenCalledTimes(1)
})
it.each(["resolve", "reject"] as const)("fences a late %s after termination", async outcome => {
    const f = fixture()
    const run = f.run()
    await vi.waitFor(() => expect(OfflineEngineRenderer.start).toHaveBeenCalled())
    const signal = vi.mocked(OfflineEngineRenderer.start).mock.calls[0][3]
    f.manager.terminate()
    expect(signal?.aborted).toBe(true)
    if (outcome === "resolve") {f.gate.resolve(AudioData.create(48000, 8, 2))}
    else {f.gate.reject(new Error("synthetic late failure"))}
    await run
    expect(f.project.engine.setFrozenAudio).not.toHaveBeenCalled()
    expect(f.unit.box.subscribeDeletion).not.toHaveBeenCalled()
    expect(RuntimeNotifier.info).not.toHaveBeenCalled()
    expect(f.copied.terminate).toHaveBeenCalledTimes(1)
    await f.run()
    expect(OfflineEngineRenderer.start).toHaveBeenCalledTimes(1)
})
it("refuses work terminated before its deferred start", async () => {
    const f = fixture()
    const run = f.run()
    f.manager.terminate()
    await run
    expect(f.project.copy).not.toHaveBeenCalled()
})
it.each(["success", "failure", "abort"] as const)("releases copy and dialog after %s", async outcome => {
    const f = fixture()
    const close = vi.fn()
    vi.mocked(RuntimeNotifier.progress).mockReturnValueOnce({terminate: close} as never)
    const run = f.run()
    await vi.waitFor(() => expect(OfflineEngineRenderer.start).toHaveBeenCalled())
    if (outcome === "success") {f.gate.resolve(AudioData.create(48000, 8, 2))}
    else {f.gate.reject(outcome === "abort" ? new DOMException("aborted", "AbortError") : new Error("synthetic"))}
    await run
    expect(f.copied.terminate).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
})
it("releases the copy if creating progress fails", async () => {
    const f = fixture()
    vi.mocked(RuntimeNotifier.progress).mockImplementationOnce(() => {throw new Error("synthetic dialog")})
    await expect(f.run()).rejects.toThrow("synthetic dialog")
    expect(f.copied.terminate).toHaveBeenCalledTimes(1)
})
