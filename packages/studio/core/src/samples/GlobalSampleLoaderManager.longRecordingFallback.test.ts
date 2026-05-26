import {beforeEach, describe, expect, it} from "vitest"
import {Progress, UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {SampleLoaderState, SampleMetaData} from "@opendaw/studio-adapters"
import {LongRecordingSession} from "../recording/LongRecordingSession"
import {LongRecordingSource} from "../recording/LongRecordingManifest"
import {LongRecordingStorage} from "../recording/LongRecordingStorage"
import {InMemoryOpfs} from "../recording/__test_support__/InMemoryOpfs"
import {GlobalSampleLoaderManager} from "./GlobalSampleLoaderManager"

const RECORDING_UUID = UUID.asString("00000000-0000-4000-8000-000000000070")

const source = (): LongRecordingSource => ({
    kind: "test",
    label: "fallback-test",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

const channel = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

const seedLongRecording = async (opfs: InMemoryOpfs): Promise<void> => {
    const storage = LongRecordingStorage.create(RECORDING_UUID, opfs)
    let tick = 1000
    const session = new LongRecordingSession({
        storage,
        sampleRate: 48000,
        numberOfChannels: 2,
        framesPerChunk: 256,
        source: source(),
        now: () => tick++,
        overviewSamplesPerBin: 256
    })
    await session.arm()
    session.appendQuantum([channel(256, 0.5), channel(256, -0.5)])
    await session.stop()
}

class StubSampleProvider {
    fetch(_uuid: UUID.Bytes, _progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> {
        return Promise.reject(new Error("provider should not be called for long recordings"))
    }
}

const waitForLoadedOrError = (loader: ReturnType<GlobalSampleLoaderManager["getOrCreate"]>): Promise<SampleLoaderState> =>
    new Promise(resolve => {
        const subscription = loader.subscribe(state => {
            if (state.type === "loaded" || state.type === "error") {
                queueMicrotask(() => subscription.terminate())
                resolve(state)
            }
        })
    })

let opfs: InMemoryOpfs

beforeEach(() => {opfs = new InMemoryOpfs()})

describe("GlobalSampleLoaderManager long-recording fallback", () => {
    it("populates the original SampleLoader with materialized audio + overview peaks", async () => {
        await seedLongRecording(opfs)
        const manager = new GlobalSampleLoaderManager(new StubSampleProvider(), {opfsProvider: () => opfs})
        const uuid = UUID.parse(RECORDING_UUID)
        const loader = manager.getOrCreate(uuid)
        const state = await waitForLoadedOrError(loader)
        expect(state.type).toBe("loaded")
        expect(loader.data.nonEmpty()).toBe(true)
        expect(loader.peaks.nonEmpty()).toBe(true)
        const audio = loader.data.unwrap()
        expect(audio.sampleRate).toBe(48000)
        expect(audio.numberOfChannels).toBe(2)
        expect(audio.numberOfFrames).toBe(256)
        expect(manager.getOrCreate(uuid)).toBe(loader)
    })

    it("subscribers added before completion observe progress -> loaded with data on the same loader instance", async () => {
        await seedLongRecording(opfs)
        const manager = new GlobalSampleLoaderManager(new StubSampleProvider(), {opfsProvider: () => opfs})
        const uuid = UUID.parse(RECORDING_UUID)
        const loader = manager.getOrCreate(uuid)
        const events: Array<SampleLoaderState> = []
        const subscription = loader.subscribe(state => events.push(state))
        const terminal = await waitForLoadedOrError(loader)
        subscription.terminate()
        expect(terminal.type).toBe("loaded")
        expect(events.some(event => event.type === "loaded")).toBe(true)
        expect(events.some(event => event.type === "error")).toBe(false)
    })

    it("surfaces error when neither SampleStorage nor a long recording is available", async () => {
        const manager = new GlobalSampleLoaderManager(new StubSampleProvider(), {opfsProvider: () => opfs})
        const uuid = UUID.parse(UUID.asString("00000000-0000-4000-8000-000000000071"))
        const loader = manager.getOrCreate(uuid)
        const state = await waitForLoadedOrError(loader)
        expect(state.type).toBe("error")
    })

    it("does not invoke the long-recording fallback when no opfsProvider is configured", async () => {
        await seedLongRecording(opfs)
        const manager = new GlobalSampleLoaderManager(new StubSampleProvider())
        const uuid = UUID.parse(RECORDING_UUID)
        const loader = manager.getOrCreate(uuid)
        const state = await waitForLoadedOrError(loader)
        expect(state.type).toBe("error")
    })

    it("transitions to error (not loaded) for a non-clean recording (truncated chunk)", async () => {
        await seedLongRecording(opfs)
        const chunkPath = `recordings/v1/${RECORDING_UUID}/chunks/000000.pcm`
        const original = await opfs.read(chunkPath)
        await opfs.write(chunkPath, original.slice(0, Math.floor(original.byteLength / 2)))
        const manager = new GlobalSampleLoaderManager(new StubSampleProvider(), {opfsProvider: () => opfs})
        const uuid = UUID.parse(RECORDING_UUID)
        const loader = manager.getOrCreate(uuid)
        const state = await waitForLoadedOrError(loader)
        expect(state.type).toBe("error")
        expect(loader.data.isEmpty()).toBe(true)
    })

    it("transitions to error for an active (not stopped) recording", async () => {
        const recordingId = UUID.asString("00000000-0000-4000-8000-000000000072")
        const storage = LongRecordingStorage.create(recordingId, opfs)
        let tick = 1000
        const session = new LongRecordingSession({
            storage,
            sampleRate: 48000,
            numberOfChannels: 2,
            framesPerChunk: 256,
            source: source(),
            now: () => tick++,
            overviewSamplesPerBin: 256
        })
        await session.arm()
        session.appendQuantum([channel(256, 0.5), channel(256, -0.5)])
        // No stop() — manifest stays state="active"
        const manager = new GlobalSampleLoaderManager(new StubSampleProvider(), {opfsProvider: () => opfs})
        const uuid = UUID.parse(recordingId)
        const loader = manager.getOrCreate(uuid)
        const state = await waitForLoadedOrError(loader)
        expect(state.type).toBe("error")
        expect(loader.data.isEmpty()).toBe(true)
    })
})
