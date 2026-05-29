import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {Peaks} from "@opendaw/lib-fusion"
import {SampleLoaderState} from "@opendaw/studio-adapters"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "../recording/LongRecordingMedia"
import {LongRecordingSession} from "../recording/LongRecordingSession"
import {LongRecordingSource} from "../recording/LongRecordingManifest"
import {LongRecordingStorage} from "../recording/LongRecordingStorage"
import {InMemoryOpfs} from "../recording/__test_support__/InMemoryOpfs"
import {LongRecordingSampleLoader} from "./LongRecordingSampleLoader"

const RECORDING_UUID = UUID.asString("00000000-0000-4000-8000-000000000060")

const source = (): LongRecordingSource => ({
    kind: "test",
    label: "loader-test",
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

const recordTwoChunks = async (opfs: InMemoryOpfs): Promise<void> => {
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
    session.appendQuantum([channel(256, 0.25), channel(256, -0.25)])
    await session.stop()
}

const buildLoader = async (opfs: InMemoryOpfs): Promise<LongRecordingSampleLoader> => {
    const referenceOption = await LongRecordingMediaReference.load(RECORDING_UUID, opfs)
    const reference = referenceOption.unwrap()
    const storage = LongRecordingStorage.create(RECORDING_UUID, opfs)
    const access = LongRecordingMediaAccess.create(reference, storage)
    return await LongRecordingSampleLoader.create({uuid: UUID.parse(RECORDING_UUID), reference, access, storage})
}

describe("LongRecordingSampleLoader", () => {
    it("exposes peaks built from the overview before chunks are materialized", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const loader = await buildLoader(opfs)
        expect(loader.peaks.nonEmpty()).toBe(true)
        const peaks: Peaks = loader.peaks.unwrap()
        expect(peaks.numChannels).toBe(2)
        expect(peaks.numFrames).toBe(512)
        expect(peaks.stages.length).toBe(1)
        expect(peaks.stages[0].numPeaks).toBe(2)
        expect(loader.state.type).toBe("progress")
    })

    it("uuid matches the recording id and state advances progress -> loaded once chunks materialize", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const loader = await buildLoader(opfs)
        expect(loader.uuid).toEqual(UUID.parse(RECORDING_UUID))
        expect(loader.state.type).toBe("progress")
        await loader.materializeAudioData()
        expect(loader.state.type).toBe("loaded")
        expect(loader.data.nonEmpty()).toBe(true)
    })

    it("materializeAudioData reads chunks once and caches AudioData", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const loader = await buildLoader(opfs)
        const audio = await loader.materializeAudioData()
        expect(loader.data.nonEmpty()).toBe(true)
        expect(audio.sampleRate).toBe(48000)
        expect(audio.numberOfChannels).toBe(2)
        expect(audio.numberOfFrames).toBe(512)
        expect(Array.from(audio.frames[0].slice(0, 4))).toEqual([0.5, 0.5, 0.5, 0.5])
        expect(Array.from(audio.frames[1].slice(0, 4))).toEqual([-0.5, -0.5, -0.5, -0.5])
        expect(Array.from(audio.frames[0].slice(256, 260))).toEqual([0.25, 0.25, 0.25, 0.25])
        const second = await loader.materializeAudioData()
        expect(second).toBe(audio)
    })

    it("invalidate clears cached AudioData and lets a subsequent materialize observer see the loaded transition", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const loader = await buildLoader(opfs)
        await loader.materializeAudioData()
        expect(loader.data.nonEmpty()).toBe(true)
        loader.invalidate()
        expect(loader.data.isEmpty()).toBe(true)
        expect(loader.state.type).toBe("progress")
        const events: Array<SampleLoaderState> = []
        const subscription = loader.subscribe(state => events.push(state))
        const refreshed = await loader.materializeAudioData()
        expect(refreshed).toBe(loader.data.unwrap())
        expect(events.some(event => event.type === "loaded")).toBe(true)
        subscription.terminate()
    })

    it("subscribe replays the current state to a new observer once loaded", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const loader = await buildLoader(opfs)
        await loader.materializeAudioData()
        const events: Array<SampleLoaderState> = []
        const subscription = loader.subscribe(state => events.push(state))
        expect(events.at(0)?.type).toBe("loaded")
        subscription.terminate()
    })

    it("media reference is reachable through the loader for surface logic that needs the manifest state", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const loader = await buildLoader(opfs)
        expect(loader.reference.kind).toBe("long-recording")
        expect(loader.reference.state).toBe("stopped")
        expect(loader.meta.nonEmpty()).toBe(true)
        const meta = loader.meta.unwrap()
        expect(meta.sample_rate).toBe(48000)
        expect(meta.origin).toBe("recording")
    })

    it("construction reads only the overview (no chunk PCM) — verified by counting chunk reads", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        const reference = (await LongRecordingMediaReference.load(RECORDING_UUID, opfs)).unwrap()
        const storage = LongRecordingStorage.create(RECORDING_UUID, opfs)
        const realAccess = LongRecordingMediaAccess.create(reference, storage)
        let chunkReads = 0
        const trackingAccess: LongRecordingMediaAccess = {
            reference: realAccess.reference,
            locateFrame: index => realAccess.locateFrame(index),
            locateSeconds: seconds => realAccess.locateSeconds(seconds),
            readOverviewBins: () => realAccess.readOverviewBins(),
            readChunkSamples: index => {chunkReads++; return realAccess.readChunkSamples(index)}
        }
        const loader = await LongRecordingSampleLoader.create({
            uuid: UUID.parse(RECORDING_UUID), reference, access: trackingAccess, storage
        })
        expect(loader.peaks.nonEmpty()).toBe(true)
        expect(loader.state.type).toBe("progress")
        expect(chunkReads).toBe(0)
        // Inspection consumers that only read peaks must not trigger PCM allocation.
        expect(loader.data.isEmpty()).toBe(true)
    })

    it("refuses to materialize a non-clean recording (truncated chunk)", async () => {
        const opfs = new InMemoryOpfs()
        await recordTwoChunks(opfs)
        // Truncate the first chunk file to simulate a corrupt recording.
        const chunkPath = `recordings/v1/${RECORDING_UUID}/chunks/000000.pcm`
        const original = await opfs.read(chunkPath)
        await opfs.write(chunkPath, original.slice(0, Math.floor(original.byteLength / 2)))
        const loader = await buildLoader(opfs)
        const events: Array<SampleLoaderState> = []
        const subscription = loader.subscribe(state => events.push(state))
        loader.requestData()
        await new Promise(resolve => setTimeout(resolve, 50))
        const terminal = events.find(event => event.type === "loaded" || event.type === "error")
        expect(terminal).toBeDefined()
        expect(terminal?.type).toBe("error")
        expect(loader.data.isEmpty()).toBe(true)
        subscription.terminate()
    })

    it("refuses to materialize an active (not yet stopped) recording", async () => {
        const opfs = new InMemoryOpfs()
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
        // Do NOT call session.stop() — manifest stays state="active"
        await new Promise(resolve => setTimeout(resolve, 50))
        const loader = await buildLoader(opfs)
        await expect(loader.materializeAudioData()).rejects.toBeDefined()
        expect(loader.state.type).toBe("error")
    })
})
