import {beforeEach, describe, expect, it} from "vitest"
import {Option, UUID} from "@opendaw/lib-std"
import {BoxGraph} from "@opendaw/lib-box"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {AudioFileBox, BoxIO, MetaDataBox} from "@opendaw/studio-boxes"
import {LongRecordingArtifact} from "./LongRecordingArtifact"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "./LongRecordingMedia"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {InMemoryOpfs} from "./__test_support__/InMemoryOpfs"

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "project-rt",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

interface ProjectFixture {
    readonly graph: BoxGraph<BoxIO.TypeMap>
    readonly fileBox: AudioFileBox
    readonly metaBox: MetaDataBox
    readonly recordingId: UUID.String
    readonly recordingUuid: UUID.Bytes
    readonly durationSeconds: number
}

const buildAndPersistFixture = async (opfs: OpfsProtocol, framesPerChannel: number): Promise<ProjectFixture> => {
    const graph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
    graph.beginTransaction()
    const recordingUuid = UUID.generate()
    const recordingId = UUID.asString(UUID.toString(recordingUuid))
    const fileBox = AudioFileBox.create(graph, recordingUuid, box => {
        box.fileName.setValue(`recording-${recordingId.slice(0, 8)}`)
        box.startInSeconds.setValue(0)
        box.endInSeconds.setValue(0)
    })
    const metaBox = MetaDataBox.create(graph, UUID.generate(), box => {
        box.target.refer(fileBox)
        box.origin.setValue("long-recording")
        box.value.setValue(JSON.stringify({recordingId}))
    })
    graph.endTransaction()
    const sampleRate = 48000
    const storage = LongRecordingStorage.create(recordingId, opfs)
    let tick = 1000
    const session = new LongRecordingSession({
        storage,
        sampleRate,
        numberOfChannels: 2,
        framesPerChunk: framesPerChannel,
        source: exampleSource(),
        now: () => tick++
    })
    await session.arm()
    session.appendQuantum([channelOf(framesPerChannel, 0.4), channelOf(framesPerChannel, -0.4)])
    session.appendQuantum([channelOf(framesPerChannel, 0.2), channelOf(framesPerChannel, -0.2)])
    await session.stop()
    const durationSeconds = (framesPerChannel * 2) / sampleRate
    graph.beginTransaction()
    fileBox.endInSeconds.setValue(durationSeconds)
    graph.endTransaction()
    return {graph, fileBox, metaBox, recordingId, recordingUuid, durationSeconds}
}

let sourceOpfs: InMemoryOpfs

beforeEach(() => {sourceOpfs = new InMemoryOpfs()})

describe("Project save/load round trip preserves long-recording media", () => {
    it("AudioFileBox uuid + chunk-backed media survive bundle/unbundle on a fresh OPFS", async () => {
        const fixture = await buildAndPersistFixture(sourceOpfs, 8)
        const projectBytes = fixture.graph.toArrayBuffer()
        const recordingFiles = await LongRecordingArtifact.collect(sourceOpfs, fixture.recordingId)
        expect(recordingFiles.length).toBeGreaterThan(0)
        const restoredOpfs = new InMemoryOpfs()
        const restoredManifestOption = await LongRecordingArtifact.restore(
            restoredOpfs, fixture.recordingId, recordingFiles)
        expect(restoredManifestOption.nonEmpty()).toBe(true)
        const restoredGraph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
        restoredGraph.fromArrayBuffer(projectBytes)
        const restoredFileBoxes = restoredGraph.boxes().filter(box => box instanceof AudioFileBox) as AudioFileBox[]
        expect(restoredFileBoxes).toHaveLength(1)
        const restoredFileBox = restoredFileBoxes[0]
        expect(UUID.toString(restoredFileBox.address.uuid)).toBe(fixture.recordingId)
        expect(restoredFileBox.endInSeconds.getValue()).toBeCloseTo(fixture.durationSeconds, 6)
    })

    it("restored manifest preserves sample rate, channels, overview spec, channel order, state", async () => {
        const fixture = await buildAndPersistFixture(sourceOpfs, 8)
        const recordingFiles = await LongRecordingArtifact.collect(sourceOpfs, fixture.recordingId)
        const restoredOpfs = new InMemoryOpfs()
        const restoredManifest = (await LongRecordingArtifact.restore(
            restoredOpfs, fixture.recordingId, recordingFiles)).unwrap()
        expect(restoredManifest.sampleRate).toBe(48000)
        expect(restoredManifest.numberOfChannels).toBe(2)
        expect(restoredManifest.state).toBe("stopped")
        expect(restoredManifest.overview).toEqual({samplesPerBin: 256, bytesPerBin: 8})
        const restoredStorage = LongRecordingStorage.create(fixture.recordingId, restoredOpfs)
        const reference = LongRecordingMediaReference.fromManifest(restoredManifest)
        expect(reference.durationSeconds).toBeCloseTo(fixture.durationSeconds, 6)
        const access = LongRecordingMediaAccess.create(reference, restoredStorage)
        const firstChunk = await access.readChunkSamples(0)
        expect(firstChunk[0].length).toBe(8)
        for (const value of firstChunk[0]) {expect(value).toBeCloseTo(0.4, 6)}
        for (const value of firstChunk[1]) {expect(value).toBeCloseTo(-0.4, 6)}
        const secondChunk = await access.readChunkSamples(1)
        expect(secondChunk[0].length).toBe(8)
        for (const value of secondChunk[0]) {expect(value).toBeCloseTo(0.2, 6)}
        for (const value of secondChunk[1]) {expect(value).toBeCloseTo(-0.2, 6)}
    })

    it("waveform overview survives the round trip without re-encoding raw audio", async () => {
        const fixture = await buildAndPersistFixture(sourceOpfs, 16)
        const recordingFiles = await LongRecordingArtifact.collect(sourceOpfs, fixture.recordingId)
        const restoredOpfs = new InMemoryOpfs()
        await LongRecordingArtifact.restore(restoredOpfs, fixture.recordingId, recordingFiles)
        const restoredStorage = LongRecordingStorage.create(fixture.recordingId, restoredOpfs)
        const restoredManifest = (await restoredStorage.readManifest()).unwrap()
        const reference = LongRecordingMediaReference.fromManifest(restoredManifest)
        const access = LongRecordingMediaAccess.create(reference, restoredStorage)
        const bins = await access.readOverviewBins()
        expect(bins.length).toBeGreaterThan(0)
        const channel0Bins = bins.filter(bin => bin.channel === 0)
        const channel1Bins = bins.filter(bin => bin.channel === 1)
        expect(channel0Bins.length).toBeGreaterThan(0)
        expect(channel1Bins.length).toBeGreaterThan(0)
        expect(channel0Bins.every(bin => bin.min > 0 && bin.max > 0)).toBe(true)
        expect(channel1Bins.every(bin => bin.min < 0 && bin.max < 0)).toBe(true)
    })

    it("project bytes alone do not pull in the chunk audio (memory-bounded references)", async () => {
        const fixture = await buildAndPersistFixture(sourceOpfs, 24)
        const projectBytes = fixture.graph.toArrayBuffer()
        expect(projectBytes.byteLength).toBeLessThan(8_000)
    })
})
