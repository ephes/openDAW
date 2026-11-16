import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Errors, Option, RuntimeNotifier, Terminable, UUID} from "@opendaw/lib-std"
import {CaptureAudio} from "./CaptureAudio"
import {RecordAudio} from "./RecordAudio"
import {AudioDevices} from "../AudioDevices"

vi.mock("./RecordAudio", () => ({RecordAudio: {start: vi.fn()}}))
vi.mock("../RecordingWorklet", () => ({RecordingWorklet: class {}}))
class Node {
    gain = {value: 0}
    pan = {value: 0}
    stream = {}
    connections = new Set<Node>()
    connect(target: Node) {this.connections.add(target)}
    disconnect(target?: Node) {if (target) {this.connections.delete(target)} else {this.connections.clear()}}
}
let elements: Array<{srcObject: unknown, pause: ReturnType<typeof vi.fn>}>
let rejectSink: boolean
let rejectPlay: boolean
beforeEach(() => {
    elements = []; rejectSink = false; rejectPlay = false
    vi.stubGlobal("Audio", class {
        srcObject: unknown
        pause = vi.fn()
        constructor() {elements.push(this)}
        async setSinkId() {if (rejectSink) {throw new Error("synthetic sink")}}
        async play() {if (rejectPlay) {throw new Error("synthetic play")}}
    })
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
const setup = async () => {
    const destination = new Node()
    const context = {outputLatency: 0.01, baseLatency: 0.02, destination, createGain: () => new Node(), createStereoPanner: () => new Node(), createMediaStreamSource: () => new Node(), createMediaStreamDestination: () => new Node()}
    const track = {label: "synthetic-private-label", getSettings: () => ({channelCount: 1, deviceId: "synthetic-private-id", latency: 0.03}), stop: vi.fn()}
    vi.spyOn(AudioDevices, "requestStream").mockResolvedValue({getAudioTracks: () => [track]} as unknown as MediaStream)
    const manager = {project: {timelineBox: {bpm: new DefaultObservableValue(120)}, env: {audioContext: context, audioWorklets: {createRecording: vi.fn(() => ({uuid: UUID.generate(), terminate: vi.fn(), disconnect: vi.fn()}))}, sampleManager: {record: vi.fn(), remove: vi.fn()}, sampleService: {}}}}
    const unit = {address: {uuid: UUID.generate()}}
    const box = {deviceId: new DefaultObservableValue(""), requestChannels: new DefaultObservableValue(1), gainDb: new DefaultObservableValue(0)}
    type Args = ConstructorParameters<typeof CaptureAudio>
    const capture = new CaptureAudio(manager as unknown as Args[0], unit as unknown as Args[1], box as unknown as Args[2])
    capture.monitoringMode = "direct"
    await vi.waitFor(() => expect(capture.stream.nonEmpty()).toBe(true))
    return {capture, destination, manager}
}
for (const failure of ["sink", "play"]) {
    it(`reconnects default monitoring after ${failure} failure and permits later changes`, async () => {
        const {capture, destination} = await setup()
        await capture.setMonitorOutputDevice(Option.wrap("first"))
        const first = elements[0]
        if (failure === "sink") {rejectSink = true} else {rejectPlay = true}
        await capture.setMonitorOutputDevice(Option.wrap("second"))
        expect(capture.monitorOutputDeviceId.isEmpty()).toBe(true)
        expect((capture.monitorPanNode as unknown as Node).connections.size).toBe(1)
        expect((capture.monitorPanNode as unknown as Node).connections.has(destination)).toBe(true)
        expect(first.srcObject).toBe(null)
        expect(elements[1].srcObject).toBe(null)
        rejectSink = false; rejectPlay = false
        await capture.setMonitorOutputDevice(Option.wrap("third"))
        expect((capture.monitorPanNode as unknown as Node).connections.size).toBe(1)
        expect((capture.monitorPanNode as unknown as Node).connections.has(destination)).toBe(false)
        capture.terminate()
    })
}

it("keeps device markers and raw fallback errors out of recorded diagnostics", async () => {
    const logs: unknown[][] = []
    vi.spyOn(console, "debug").mockImplementation((...args) => {logs.push(args)})
    vi.spyOn(console, "warn").mockImplementation((...args) => {logs.push(args)})
    const {capture} = await setup()
    vi.mocked(AudioDevices.requestStream).mockRejectedValueOnce(new Error("synthetic-private-exception"))
    capture.deviceId.setValue(Option.wrap("synthetic-private-request"))
    await vi.waitFor(() => expect(AudioDevices.requestStream).toHaveBeenCalledTimes(3))
    await capture.prepareRecording()
    capture.startRecording()
    const payload = JSON.stringify(logs)
    expect(payload).not.toContain("synthetic-private")
    expect(payload).toContain("channel")
    expect(payload).toContain("0.01")
    capture.terminate()
})
for (const [error, category] of [
    [{constraint: "deviceId", message: "synthetic-private-error"}, "Audio input constraints could not be satisfied"],
    [new DOMException("synthetic-private-error", "NotAllowedError"), "Audio input permission denied"],
    [new Error("synthetic-private-error"), "Audio input unavailable"]
] as const) {
    it(`normalizes getUserMedia failure: ${category}`, async () => {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices")
        Object.defineProperty(navigator, "mediaDevices", {configurable: true, value: {getUserMedia: vi.fn().mockRejectedValue(error)}})
        try {
            await expect(AudioDevices.requestStream({deviceId: {exact: "synthetic-private-id"}})).rejects.toThrow(category)
        } finally {
            if (descriptor) {Object.defineProperty(navigator, "mediaDevices", descriptor)}
            else {Reflect.deleteProperty(navigator, "mediaDevices")}
        }
    })
}

for (const failure of ["registration", "connection", "start", "retirement"]) {
    it(`releases the prepared recording resources on ${failure}`, async () => {
        const {capture, manager} = await setup()
        const {sampleManager, audioWorklets} = manager.project.env
        if (failure === "registration") {sampleManager.record.mockImplementationOnce(() => {throw new Error("synthetic registration")})}
        if (failure === "connection") {
            const create = audioWorklets.createRecording.getMockImplementation()!
            audioWorklets.createRecording.mockImplementationOnce(() => {
                const worklet = create()
                vi.spyOn(capture.outputNode.unwrap(), "connect").mockImplementationOnce(() => {throw new Error("synthetic connection")})
                return worklet
            })
        }
        if (failure === "start") {vi.mocked(RecordAudio.start).mockImplementationOnce(() => {throw new Error("synthetic start")})}
        if (failure === "registration" || failure === "connection") {
            await expect(capture.prepareRecording()).rejects.toThrow(`synthetic ${failure}`)
        }
        else {
            const prepared = await capture.prepareRecording()
            if (failure === "start") {expect(() => capture.startRecording()).toThrow("synthetic start")}
            if (failure === "retirement") {capture.terminate()}
            prepared.terminate()
            prepared.terminate()
        }
        const worklet = audioWorklets.createRecording.mock.results[0].value
        expect(worklet.terminate).toHaveBeenCalledTimes(1)
        expect(worklet.disconnect).toHaveBeenCalledTimes(1)
        expect(sampleManager.remove).toHaveBeenCalledWith(worklet.uuid)
        if (failure === "retirement") {expect(capture.stream.isEmpty()).toBe(true); return}
        expect(capture.stream.nonEmpty()).toBe(true)
        vi.mocked(RecordAudio.start).mockReturnValue(Terminable.Empty)
        const prepared = await capture.prepareRecording()
        capture.startRecording()
        prepared.terminate()
        expect(audioWorklets.createRecording.mock.results[1].value.terminate).not.toHaveBeenCalled()
        capture.terminate()
    })
}

it.each(["old fails", "old succeeds last", "new succeeds last", "retire"])("keeps the latest monitor route: %s", async order => {
    const {capture, destination} = await setup()
    const sinks = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const plays = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const destinations: Node[] = []
    vi.stubGlobal("Audio", class {
        srcObject: unknown
        pause = vi.fn()
        index = elements.length
        constructor() {elements.push(this)}
        setSinkId() {return sinks[this.index].promise}
        play() {return plays[this.index].promise}
    })
    const context = capture.manager.project.env.audioContext
    vi.spyOn(context, "createMediaStreamDestination").mockImplementation(() => {
        const node = new Node(); destinations.push(node)
        return node as unknown as MediaStreamAudioDestinationNode
    })
    const old = capture.setMonitorOutputDevice(Option.wrap("old"))
    sinks[0].resolve(); await Promise.resolve()
    const newer = capture.setMonitorOutputDevice(Option.wrap("new"))
    sinks[1].resolve(); await Promise.resolve()
    if (order === "new succeeds last") {plays[0].resolve(); await old}
    if (order === "retire") {capture.terminate()}
    plays[1].resolve(); await newer
    if (order === "old fails") {plays[0].reject(new Error("synthetic old sink"))}
    else {plays[0].resolve()}
    await old
    const connected = (capture.monitorPanNode as unknown as Node).connections
    expect(elements[0].srcObject).toBe(null)
    expect(elements[0].pause).toHaveBeenCalled()
    if (order === "retire") {
        expect(connected.size).toBe(0)
        expect(elements[1].srcObject).toBe(null)
    } else {
        expect(capture.monitorOutputDeviceId.unwrap()).toBe("new")
        expect(connected.size).toBe(1)
        expect(connected.has(destinations[1])).toBe(true)
        expect(connected.has(destination)).toBe(false)
        expect(elements[1].srcObject).not.toBe(null)
        capture.terminate()
    }
})

it("stops a stream that arrives after capture retirement and allocates no recording worklet", async () => {
    const {capture, manager} = await setup()
    const acquired = Promise.withResolvers<MediaStream>()
    vi.mocked(AudioDevices.requestStream).mockReturnValueOnce(acquired.promise)
    capture.deviceId.setValue(Option.wrap("synthetic-late-input"))
    await vi.waitFor(() => expect(AudioDevices.requestStream).toHaveBeenCalledTimes(2))
    const preparation = capture.prepareRecording()
    const outcome = preparation.catch(error => error)
    capture.terminate()
    const track = {stop: vi.fn()}
    acquired.resolve({getAudioTracks: () => [track]} as unknown as MediaStream)
    expect(await outcome).toBe(Errors.AbortError)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(capture.stream.isEmpty()).toBe(true)
    expect(manager.project.env.audioWorklets.createRecording).not.toHaveBeenCalled()
})

it.each([false, true])("retires a superseded sink acquisition (old refusal: %s)", async refusal => {
    const {capture} = await setup()
    const sink = Promise.withResolvers<void>()
    const play: Array<ReturnType<typeof vi.fn>> = []
    vi.stubGlobal("Audio", class {
        srcObject: unknown
        pause = vi.fn()
        index = elements.length
        constructor() {elements.push(this); play.push(vi.fn().mockResolvedValue(undefined))}
        setSinkId() {return this.index === 0 ? sink.promise : Promise.resolve()}
        play() {return play[this.index]()}
    })
    const old = capture.setMonitorOutputDevice(Option.wrap("old"))
    await capture.setMonitorOutputDevice(Option.wrap("new"))
    if (refusal) {sink.reject(new Error("synthetic stale sink"))} else {sink.resolve()}
    await old
    expect(play[0]).not.toHaveBeenCalled()
    expect(capture.monitorOutputDeviceId.unwrap()).toBe("new")
    expect(elements[0].srcObject).toBe(null)
    expect(elements[1].srcObject).not.toBe(null)
    capture.terminate()
})
