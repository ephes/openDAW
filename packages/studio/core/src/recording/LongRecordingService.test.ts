import {beforeEach, describe, expect, it} from "vitest"
import {Notifier, Observer, Subscription, Terminator, UUID} from "@opendaw/lib-std"
import {CaptureContinuityReport, CaptureSource, CaptureSourceMetadata} from "../capture-source"
import {LongRecordingChunkBuffer} from "./LongRecordingChunkBuffer"
import {
    captureMetadataToLongRecordingSource,
    LongRecordingService
} from "./LongRecordingService"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {InMemoryOpfs} from "./__test_support__/InMemoryOpfs"

const RECORDING_UUID = UUID.asString("00000000-0000-4000-8000-000000000060")

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

class StubAudioNode {
    readonly connections: Array<AudioNode> = []
    connect(target: AudioNode): AudioNode {
        this.connections.push(target)
        return target
    }
    disconnect(_target?: AudioNode): void {
        this.connections.length = 0
    }
}

class StubCaptureSource implements CaptureSource {
    readonly #terminator = new Terminator()
    readonly metadata: CaptureSourceMetadata
    readonly outputNode: AudioNode
    readonly #continuityNotifier = new Notifier<CaptureContinuityReport>()
    readonly #errorNotifier = new Notifier<unknown>()
    terminated = false

    constructor(metadata: CaptureSourceMetadata) {
        this.metadata = metadata
        this.outputNode = new StubAudioNode() as unknown as AudioNode
    }

    subscribeContinuity(observer: Observer<CaptureContinuityReport>): Subscription {
        return this.#continuityNotifier.subscribe(observer)
    }

    subscribeErrors(observer: Observer<unknown>): Subscription {
        return this.#errorNotifier.subscribe(observer)
    }

    terminate(): void {
        this.terminated = true
        this.#terminator.terminate()
    }
}

let opfs: InMemoryOpfs

beforeEach(() => {opfs = new InMemoryOpfs()})

describe("LongRecordingService.prepareSessionFromCaptureSource", () => {
    it("arms a session whose manifest carries requested vs actual sample rate and channels from the capture source", async () => {
        const storage = LongRecordingStorage.create(RECORDING_UUID, opfs)
        const capture = new StubCaptureSource({
            kind: "getUserMedia",
            label: "ZOOM-test",
            deviceId: "zoom-l12",
            deviceLabel: "ZOOM L-12",
            requestedSampleRate: 48000,
            requestedChannels: 6,
            actualSampleRate: 44100,
            deviceChannels: 6,
            actualChannels: 2,
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
        })
        const armed = await LongRecordingService.prepareSessionFromCaptureSource({
            storage,
            captureSource: capture,
            framesPerChunk: 4,
            now: () => 1
        })
        expect(armed.session.sessionState).toBe("armed")
        const persisted = (await storage.readManifest()).unwrap()
        expect(persisted.sampleRate).toBe(44100)
        expect(persisted.numberOfChannels).toBe(2)
        expect(persisted.source.requestedSampleRate).toBe(48000)
        expect(persisted.source.actualSampleRate).toBe(44100)
        expect(persisted.source.requestedChannels).toBe(6)
        expect(persisted.source.actualChannels).toBe(2)
        expect(persisted.source.label).toBe("ZOOM-test")
        armed.session.appendQuantum([channelOf(4, 0.1), channelOf(4, -0.1)])
        await armed.session.stop()
        const reloaded = (await storage.readManifest()).unwrap()
        const samples = LongRecordingChunkBuffer.deinterleave(
            await storage.readChunk(0), reloaded.numberOfChannels, reloaded.chunks[0].frames)
        expect(samples[0].length).toBe(4)
        for (const value of samples[0]) {expect(value).toBeCloseTo(0.1, 6)}
    })

    it("captureMetadataToLongRecordingSource returns a LongRecordingSource shape", () => {
        const projected = captureMetadataToLongRecordingSource({
            kind: "synthetic",
            label: "osc",
            requestedSampleRate: 48000,
            requestedChannels: 2,
            actualSampleRate: 48000,
            deviceChannels: 2,
            actualChannels: 2,
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
        })
        expect(projected).toEqual({
            kind: "synthetic",
            label: "osc",
            requestedSampleRate: 48000,
            requestedChannels: 2,
            actualSampleRate: 48000,
            actualChannels: 2
        })
    })

    it("CaptureSourceMetadata.mismatches detects requested vs actual drift", () => {
        const reports = CaptureSourceMetadata.mismatches({
            kind: "getUserMedia",
            label: "drifted",
            requestedSampleRate: 48000,
            requestedChannels: 4,
            actualSampleRate: 44100,
            deviceChannels: 4,
            actualChannels: 2,
            autoGainControl: true,
            echoCancellation: false,
            noiseSuppression: false
        })
        const kinds = reports.map(report => report.kind).sort()
        expect(kinds).toEqual(["auto-processing-modified", "channel-count", "sample-rate"])
    })
})

describe("LongRecordingService.startFromSource", () => {
    it("wires the capture source output into a worklet, stops cleanly, and terminates both", async () => {
        const storage = LongRecordingStorage.create(RECORDING_UUID, opfs)
        const capture = new StubCaptureSource({
            kind: "synthetic",
            label: "osc",
            requestedSampleRate: 48000,
            requestedChannels: 1,
            actualSampleRate: 48000,
            deviceChannels: 1,
            actualChannels: 1,
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
        })
        const workletDouble: {
            terminated: boolean
            disconnected: boolean
            connect(target: AudioNode): AudioNode
            disconnect(): void
            terminate(): void
        } = {
            terminated: false,
            disconnected: false,
            connect(target: AudioNode): AudioNode {return target},
            disconnect(): void {this.disconnected = true},
            terminate(): void {this.terminated = true}
        }
        const fakeWorklets = {
            createLongRecording: () => workletDouble as never
        } as unknown as import("../AudioWorklets").AudioWorklets
        const handle = await LongRecordingService.startFromSource({
            worklets: fakeWorklets,
            storage,
            captureSource: capture,
            framesPerChunk: 4,
            now: () => 1
        })
        expect(handle.session.sessionState).toBe("armed")
        expect(LongRecordingService.recordingIdFromHandle(handle)).toBe(handle.session.recordingId)
        const captureOutput = capture.outputNode as unknown as StubAudioNode
        expect(captureOutput.connections).toHaveLength(1)
        handle.session.appendQuantum([channelOf(4, 0.25)])
        await handle.stop()
        expect(handle.session.sessionState).toBe("stopped")
        expect(workletDouble.terminated).toBe(true)
        expect(capture.terminated).toBe(true)
        expect(captureOutput.connections).toHaveLength(0)
        const persisted = (await storage.readManifest()).unwrap()
        expect(persisted.state).toBe("stopped")
        expect(persisted.chunks).toHaveLength(1)
    })
})
