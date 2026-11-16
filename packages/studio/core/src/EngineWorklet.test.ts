import {afterEach, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import {AnimationFrame} from "@opendaw/lib-dom"
import {UUID} from "@opendaw/lib-std"
import {EngineToClient, ClipNotification} from "@opendaw/studio-adapters"
import {EngineWorklet} from "./EngineWorklet"
import {Project} from "./project"

vi.hoisted(() => vi.stubGlobal("AudioWorkletNode", class extends EventTarget {
    port = {}; disconnect() {}
    constructor(readonly context: BaseAudioContext) {super()}
}))
vi.mock("./HRClockWorker", () => ({HRClockWorker: {get: () => ({sab: new SharedArrayBuffer(8)})}}))
vi.mock("./MonitoringRouter", () => ({MonitoringRouter: class {terminate() {}}}))
vi.mock("./midi", () => ({MIDIReceiver: {create: () => ({port: {}, sab: new SharedArrayBuffer(4), terminate() {}})}}))
afterEach(() => vi.restoreAllMocks())
const setup = () => {
    let rpc!: EngineToClient
    const commands = {stop: vi.fn(), stopRecording: vi.fn(), setupMIDI() {}, terminate: vi.fn(), updateSettings() {}, sendUpdates() {}}
    vi.spyOn(Communicator, "sender").mockReturnValue(commands as never)
    vi.spyOn(Communicator, "executor").mockImplementation((_messenger, executor) => {
        rpc = executor as EngineToClient
        return {terminate: vi.fn()} as never
    })
    vi.spyOn(Messenger, "for").mockReturnValue({channel: () => ({})} as unknown as Messenger)
    vi.spyOn(AnimationFrame, "add").mockReturnValue({terminate() {}})
    const project = {cancelRecordingPreparation: vi.fn(), toArrayBuffer: () => new ArrayBuffer(0), boxGraph: new BoxGraph(),
        liveStreamReceiver: {connect: () => ({terminate() {}})}, sampleManager: {}}
    const worklet = new EngineWorklet({sampleRate: 48000} as BaseAudioContext, project as unknown as Project)
    return {worklet, rpc, commands, project}
}
it("owns the initial clip snapshot and subscribes before a reentrant sequencing change", () => {
    const {worklet, rpc} = setup()
    const first = UUID.generate(), second = UUID.generate()
    rpc.notifyClipSequenceChanges({started: [first], stopped: [], obsolete: []})
    const events: ClipNotification[] = []
    const sub = worklet.subscribeClipNotification(event => {
        events.push(event)
        if (events.length === 1) {rpc.notifyClipSequenceChanges({started: [second], stopped: [first], obsolete: []})}
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({type: "sequencing", changes: {started: [first], stopped: [], obsolete: []}})
    sub.terminate(); worklet.terminate()
})
it("retires the subscription if the initial clip observer throws", () => {
    const {worklet, rpc} = setup()
    const observer = vi.fn(() => {throw new Error("synthetic observer")})
    expect(() => worklet.subscribeClipNotification(observer)).toThrow("synthetic observer")
    rpc.notifyClipSequenceChanges({started: [UUID.generate()], stopped: [], obsolete: []})
    expect(observer).toHaveBeenCalledTimes(1)
    worklet.terminate()
})

it.each(["processorerror", "error", "terminate"])("settles pending readiness on %s and ignores late ready", async fault => {
    const {worklet, rpc} = setup()
    const readiness = worklet.isReady()
    const outcome = readiness.then(() => "ready", () => "failed")
    const other = worklet.isReady().then(() => "ready", () => "failed")
    if (fault === "terminate") {worklet.terminate()}
    else {worklet.dispatchEvent(new Event(fault))}
    const settled = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("pending"), 20))])
    expect(settled).toBe("failed")
    rpc.ready()
    expect(await other).toBe("failed")
    worklet.terminate()
})
it("keeps ready settled after faults and retirement", async () => {
    const {worklet, rpc} = setup()
    rpc.ready()
    await worklet.isReady()
    worklet.dispatchEvent(new Event("processorerror"))
    worklet.terminate()
    await expect(worklet.isReady()).resolves.toBeUndefined()
})
it("observes retirement without a readiness consumer and detaches fault listeners", async () => {
    const {worklet, rpc} = setup()
    const remove = vi.spyOn(worklet, "removeEventListener")
    worklet.terminate()
    await Promise.resolve()
    expect(remove).toHaveBeenCalledWith("processorerror", expect.any(Function))
    rpc.ready()
})

it("cancels pending project acquisition when the shared worklet receives transport Stop", () => {
    const {worklet, project, commands} = setup()
    worklet.stop(true)
    expect(project.cancelRecordingPreparation).toHaveBeenCalledTimes(1)
    expect(commands.stop).toHaveBeenCalledWith(true)
    worklet.stopRecording()
    expect(project.cancelRecordingPreparation).toHaveBeenCalledTimes(2)
    worklet.terminate()
})
