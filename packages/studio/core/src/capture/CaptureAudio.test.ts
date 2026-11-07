import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {CaptureAudio} from "./CaptureAudio"
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
    const manager = {project: {timelineBox: {bpm: new DefaultObservableValue(120)}, env: {audioContext: context, audioWorklets: {createRecording: () => ({})}, sampleManager: {record: vi.fn()}, sampleService: {}}}}
    const unit = {address: {uuid: UUID.generate()}}
    const box = {deviceId: new DefaultObservableValue(""), requestChannels: new DefaultObservableValue(1), gainDb: new DefaultObservableValue(0)}
    type Args = ConstructorParameters<typeof CaptureAudio>
    const capture = new CaptureAudio(manager as unknown as Args[0], unit as unknown as Args[1], box as unknown as Args[2])
    capture.monitoringMode = "direct"
    await vi.waitFor(() => expect(capture.stream.nonEmpty()).toBe(true))
    return {capture, destination}
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
