import {beforeEach, describe, expect, it} from "vitest"
import {Notifier, Observer, Subscription, Terminator, UUID} from "@opendaw/lib-std"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {CaptureContinuityReport, CaptureSource, CaptureSourceMetadata} from "../capture-source"
import {LongRecordingChunkBuffer} from "./LongRecordingChunkBuffer"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingStorage} from "./LongRecordingStorage"

const RECORDING_UUID = UUID.asString("00000000-0000-4000-8000-000000000060")

class InMemoryOpfs implements OpfsProtocol {
    readonly files = new Map<string, Uint8Array>()

    async write(path: string, data: Uint8Array): Promise<void> {
        this.files.set(normalize(path), new Uint8Array(data))
    }

    async read(path: string): Promise<Uint8Array> {
        const data = this.files.get(normalize(path))
        if (data === undefined) {throw new Error(`No such file: ${path}`)}
        return new Uint8Array(data)
    }

    async exists(path: string): Promise<boolean> {return this.files.has(normalize(path))}

    async delete(path: string): Promise<void> {
        const normalized = normalize(path)
        if (normalized === "") {this.files.clear(); return}
        const prefix = `${normalized}/`
        for (const key of [...this.files.keys()]) {
            if (key === normalized || key.startsWith(prefix)) {this.files.delete(key)}
        }
    }

    async list(path: string): Promise<ReadonlyArray<OpfsProtocol.Entry>> {
        const normalized = normalize(path)
        const prefix = normalized === "" ? "" : `${normalized}/`
        const seen = new Map<string, OpfsProtocol.Entry>()
        for (const key of this.files.keys()) {
            if (!key.startsWith(prefix)) {continue}
            const remainder = key.slice(prefix.length)
            if (remainder.length === 0) {continue}
            const slashIndex = remainder.indexOf("/")
            if (slashIndex === -1) {
                seen.set(remainder, {name: remainder, kind: "file"})
            } else {
                const dirName = remainder.slice(0, slashIndex)
                if (!seen.has(dirName)) {seen.set(dirName, {name: dirName, kind: "directory"})}
            }
        }
        return [...seen.values()]
    }

    async size(path: string): Promise<number> {
        const data = this.files.get(normalize(path))
        if (data === undefined) {throw new Error(`No such file: ${path}`)}
        return data.byteLength
    }
}

const normalize = (path: string): string => path.replace(/^\/+|\/+$/g, "")

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

class StubCaptureSource implements CaptureSource {
    readonly #terminator = new Terminator()
    readonly metadata: CaptureSourceMetadata
    readonly outputNode: AudioNode
    readonly #continuityNotifier = new Notifier<CaptureContinuityReport>()
    readonly #errorNotifier = new Notifier<unknown>()

    constructor(metadata: CaptureSourceMetadata) {
        this.metadata = metadata
        this.outputNode = {} as AudioNode
    }

    subscribeContinuity(observer: Observer<CaptureContinuityReport>): Subscription {
        return this.#continuityNotifier.subscribe(observer)
    }

    subscribeErrors(observer: Observer<unknown>): Subscription {
        return this.#errorNotifier.subscribe(observer)
    }

    terminate(): void {this.#terminator.terminate()}
}

let opfs: InMemoryOpfs

beforeEach(() => {opfs = new InMemoryOpfs()})

describe("LongRecordingSession integrates CaptureSourceMetadata via toLongRecordingSource", () => {
    it("manifest source block reflects requested vs actual sample rate / channel count", async () => {
        const storage = LongRecordingStorage.create(RECORDING_UUID, opfs)
        const capture = new StubCaptureSource({
            kind: "getUserMedia",
            label: "ZOOM-test",
            deviceId: "zoom-l12",
            deviceLabel: "ZOOM L-12",
            requestedSampleRate: 48000,
            requestedChannels: 6,
            actualSampleRate: 44100,
            actualChannels: 2,
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
        })
        const session = new LongRecordingSession({
            storage,
            sampleRate: capture.metadata.actualSampleRate,
            numberOfChannels: capture.metadata.actualChannels,
            framesPerChunk: 4,
            source: CaptureSourceMetadata.toLongRecordingSource(capture.metadata),
            now: () => 1
        })
        await session.arm()
        session.appendQuantum([channelOf(4, 0.1), channelOf(4, -0.1)])
        await session.stop()
        const reloaded = (await storage.readManifest()).unwrap()
        expect(reloaded.source.requestedSampleRate).toBe(48000)
        expect(reloaded.source.actualSampleRate).toBe(44100)
        expect(reloaded.source.requestedChannels).toBe(6)
        expect(reloaded.source.actualChannels).toBe(2)
        expect(reloaded.source.label).toBe("ZOOM-test")
        const samples = LongRecordingChunkBuffer.deinterleave(
            await storage.readChunk(0), reloaded.numberOfChannels, reloaded.chunks[0].frames)
        expect(samples[0].length).toBe(4)
        for (const value of samples[0]) {expect(value).toBeCloseTo(0.1, 6)}
    })

    it("CaptureSourceMetadata.mismatches detects requested vs actual drift", () => {
        const capture = new StubCaptureSource({
            kind: "getUserMedia",
            label: "drifted",
            requestedSampleRate: 48000,
            requestedChannels: 4,
            actualSampleRate: 44100,
            actualChannels: 2,
            autoGainControl: true,
            echoCancellation: false,
            noiseSuppression: false
        })
        const reports = CaptureSourceMetadata.mismatches(capture.metadata)
        const kinds = reports.map(report => report.kind).sort()
        expect(kinds).toEqual(["auto-processing-modified", "channel-count", "sample-rate"])
    })
})
