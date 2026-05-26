import {beforeEach, describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {LongRecordingArtifact} from "./LongRecordingArtifact"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "./LongRecordingMedia"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {InMemoryOpfs} from "./__test_support__/InMemoryOpfs"

const SOURCE_UUID = UUID.asString("00000000-0000-4000-8000-000000000050")

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "round-trip",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

let sourceOpfs: InMemoryOpfs

beforeEach(() => {sourceOpfs = new InMemoryOpfs()})

const recordTwoChunksOnSource = async (): Promise<void> => {
    const storage = LongRecordingStorage.create(SOURCE_UUID, sourceOpfs)
    let tick = 1000
    const session = new LongRecordingSession({
        storage,
        sampleRate: 48000,
        numberOfChannels: 2,
        framesPerChunk: 4,
        source: exampleSource(),
        now: () => tick++
    })
    await session.arm()
    session.appendQuantum([channelOf(4, 0.5), channelOf(4, -0.5)])
    session.appendQuantum([channelOf(4, 0.25), channelOf(4, -0.25)])
    await session.stop()
}

describe("LongRecordingArtifact", () => {
    it("isLongRecording reports false when no manifest exists", async () => {
        expect(await LongRecordingArtifact.isLongRecording(sourceOpfs, SOURCE_UUID)).toBe(false)
    })

    it("isLongRecording reports true once a manifest is on disk", async () => {
        await recordTwoChunksOnSource()
        expect(await LongRecordingArtifact.isLongRecording(sourceOpfs, SOURCE_UUID)).toBe(true)
    })

    it("collect captures manifest + chunk + overview files", async () => {
        await recordTwoChunksOnSource()
        const files = await LongRecordingArtifact.collect(sourceOpfs, SOURCE_UUID)
        const paths = files.map(file => file.path).sort()
        expect(paths).toContain(LongRecordingStorage.MANIFEST_NAME)
        expect(paths.some(path => path.endsWith(".pcm"))).toBe(true)
        expect(paths.some(path => path.endsWith(".overview"))).toBe(true)
    })

    it("restore writes the artifact into a fresh OPFS and yields a matching manifest", async () => {
        await recordTwoChunksOnSource()
        const files = await LongRecordingArtifact.collect(sourceOpfs, SOURCE_UUID)
        const original = (await LongRecordingStorage.create(SOURCE_UUID, sourceOpfs).readManifest()).unwrap()
        const targetOpfs = new InMemoryOpfs()
        const restoredManifestOption = await LongRecordingArtifact.restore(targetOpfs, SOURCE_UUID, files)
        const restoredManifest = restoredManifestOption.unwrap()
        expect(restoredManifest).toEqual(original)
    })

    it("project save/load round trip preserves sample rate / channel count / duration / channel order / overview / state", async () => {
        await recordTwoChunksOnSource()
        const files = await LongRecordingArtifact.collect(sourceOpfs, SOURCE_UUID)
        const original = (await LongRecordingStorage.create(SOURCE_UUID, sourceOpfs).readManifest()).unwrap()
        const targetOpfs = new InMemoryOpfs()
        await LongRecordingArtifact.restore(targetOpfs, SOURCE_UUID, files)
        const restored = LongRecordingStorage.create(SOURCE_UUID, targetOpfs)
        const restoredManifest = (await restored.readManifest()).unwrap()
        expect(restoredManifest.sampleRate).toBe(original.sampleRate)
        expect(restoredManifest.numberOfChannels).toBe(original.numberOfChannels)
        expect(restoredManifest.totalFrames).toBe(original.totalFrames)
        expect(restoredManifest.chunks.map(chunk => chunk.frames))
            .toEqual(original.chunks.map(chunk => chunk.frames))
        expect(restoredManifest.overview).toEqual(original.overview)
        expect(restoredManifest.state).toBe("stopped")
        const reference = LongRecordingMediaReference.fromManifest(restoredManifest)
        const access = LongRecordingMediaAccess.create(reference, restored)
        const samples = await access.readChunkSamples(0)
        expect(samples).toHaveLength(2)
        expect(Array.from(samples[0])).toEqual([0.5, 0.5, 0.5, 0.5])
        expect(Array.from(samples[1])).toEqual([-0.5, -0.5, -0.5, -0.5])
        const bins = await access.readOverviewBins()
        expect(bins.length).toBeGreaterThan(0)
    })

    it("a long recording is recoverable from a partial artifact (missing trailing chunk)", async () => {
        await recordTwoChunksOnSource()
        const files = await LongRecordingArtifact.collect(sourceOpfs, SOURCE_UUID)
        const withoutLastChunk = files.filter(file => !file.path.endsWith("000001.pcm"))
        const targetOpfs = new InMemoryOpfs()
        await LongRecordingArtifact.restore(targetOpfs, SOURCE_UUID, withoutLastChunk)
        const verifyOption = await LongRecordingArtifact.verifyRoundTrip(targetOpfs, SOURCE_UUID)
        expect(verifyOption.nonEmpty()).toBe(true)
        const report = verifyOption.unwrap()
        expect(["recoverable", "corrupt"]).toContain(report.recovery.overall)
        expect(report.recovery.chunks.some(status => status.type === "missing")).toBe(true)
    })

    it("verifyRoundTrip returns Option.None when no recording exists", async () => {
        const report = await LongRecordingArtifact.verifyRoundTrip(sourceOpfs, SOURCE_UUID)
        expect(report.isEmpty()).toBe(true)
    })

    it("probeAll returns an empty list when the recordings root is missing", async () => {
        const entries = await LongRecordingArtifact.probeAll(sourceOpfs)
        expect(entries).toEqual([])
    })

    it("probeAll reports every recording with manifest, including clean and non-clean", async () => {
        await recordTwoChunksOnSource()
        const truncatedId = UUID.asString("00000000-0000-4000-8000-000000000051")
        const truncatedFiles = await LongRecordingArtifact.collect(sourceOpfs, SOURCE_UUID)
        await LongRecordingArtifact.restore(
            sourceOpfs, truncatedId, truncatedFiles.filter(file => !file.path.endsWith("000001.pcm"))
        )
        const entries = await LongRecordingArtifact.probeAll(sourceOpfs)
        const ids = entries.map(entry => entry.recordingId).sort()
        expect(ids).toEqual([SOURCE_UUID, truncatedId].sort())
        const cleanEntry = entries.find(entry => entry.recordingId === SOURCE_UUID)
        expect(cleanEntry?.report.recovery.overall).toBe("clean")
        const truncatedEntry = entries.find(entry => entry.recordingId === truncatedId)
        expect(truncatedEntry?.report.recovery.overall).not.toBe("clean")
    })
})
