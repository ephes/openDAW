import {beforeEach, describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {
    BundleFolderEntry,
    BundleFolderReader,
    BundleFolderWriter,
    LongRecordingBundleAdapter
} from "./LongRecordingBundleAdapter"
import {LongRecordingArtifact} from "./LongRecordingArtifact"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {InMemoryOpfs} from "./__test_support__/InMemoryOpfs"

const RECORDING_UUID = UUID.asString("00000000-0000-4000-8000-000000000070")
const SAMPLE_UUID = UUID.asString("00000000-0000-4000-8000-000000000071")
const OTHER_RECORDING_UUID = UUID.asString("00000000-0000-4000-8000-000000000072")

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "bundle",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

class FolderDouble implements BundleFolderWriter, BundleFolderReader {
    readonly files = new Map<string, Uint8Array>()

    file(path: string, data: Uint8Array, _options?: {binary: boolean}): void {
        this.files.set(path, data)
    }

    forEach(callback: (path: string, file: BundleFolderEntry) => void): void {
        for (const [path, bytes] of this.files) {
            const entry: BundleFolderEntry = {
                dir: false,
                async: async () => {
                    const copy = new Uint8Array(bytes)
                    return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer
                }
            }
            callback(path, entry)
        }
    }
}

const recordOnSource = async (opfs: InMemoryOpfs, recordingId: UUID.String, frames: number): Promise<void> => {
    const storage = LongRecordingStorage.create(recordingId, opfs)
    let tick = 1000
    const session = new LongRecordingSession({
        storage,
        sampleRate: 48000,
        numberOfChannels: 2,
        framesPerChunk: frames,
        source: exampleSource(),
        now: () => tick++
    })
    await session.arm()
    session.appendQuantum([channelOf(frames, 0.5), channelOf(frames, -0.5)])
    await session.stop()
}

let opfs: InMemoryOpfs

beforeEach(() => {opfs = new InMemoryOpfs()})

describe("LongRecordingBundleAdapter.classifyAudioFileBoxes", () => {
    it("splits AudioFileBox uuids by presence of a long-recording manifest", async () => {
        await recordOnSource(opfs, RECORDING_UUID, 4)
        const result = await LongRecordingBundleAdapter.classifyAudioFileBoxes(opfs, [
            {uuid: UUID.parse(RECORDING_UUID)},
            {uuid: UUID.parse(SAMPLE_UUID)}
        ])
        expect(result.longRecordings.map(ref => UUID.toString(ref.uuid))).toEqual([RECORDING_UUID])
        expect(result.sampleBoxes.map(ref => UUID.toString(ref.uuid))).toEqual([SAMPLE_UUID])
    })

    it("treats every uuid as a sample when no recordings exist", async () => {
        const result = await LongRecordingBundleAdapter.classifyAudioFileBoxes(opfs, [
            {uuid: UUID.parse(SAMPLE_UUID)},
            {uuid: UUID.parse(RECORDING_UUID)}
        ])
        expect(result.longRecordings).toHaveLength(0)
        expect(result.sampleBoxes).toHaveLength(2)
    })
})

describe("LongRecordingBundleAdapter.writeIntoFolder", () => {
    it("collects manifest + chunk + overview files into the bundle folder", async () => {
        await recordOnSource(opfs, RECORDING_UUID, 4)
        const folder = new FolderDouble()
        const files = await LongRecordingBundleAdapter.writeIntoFolder(
            opfs, {uuid: UUID.parse(RECORDING_UUID)}, folder)
        expect(files.length).toBeGreaterThan(0)
        expect(folder.files.has("manifest.json")).toBe(true)
        const paths = [...folder.files.keys()]
        expect(paths.some(path => path.endsWith(".pcm"))).toBe(true)
        expect(paths.some(path => path.endsWith(".overview"))).toBe(true)
    })
})

describe("LongRecordingBundleAdapter.restoreFromFolder", () => {
    it("writes the bundled recording back into a fresh OPFS under recordings/v1/<uuid>/", async () => {
        await recordOnSource(opfs, RECORDING_UUID, 4)
        const folder = new FolderDouble()
        const collected = await LongRecordingArtifact.collect(opfs, RECORDING_UUID)
        for (const file of collected) {
            folder.file(`${RECORDING_UUID}/${file.path}`, file.bytes)
        }
        const target = new InMemoryOpfs()
        const restored = await LongRecordingBundleAdapter.restoreFromFolder(target, folder)
        expect(restored).toContain(RECORDING_UUID)
        const restoredManifest = await LongRecordingStorage.create(RECORDING_UUID, target).readManifest()
        expect(restoredManifest.nonEmpty()).toBe(true)
        expect(restoredManifest.unwrap().state).toBe("stopped")
    })

    it("ignores entries whose top-level segment is not a recording UUID", async () => {
        const folder = new FolderDouble()
        folder.file("not-a-uuid/manifest.json", new TextEncoder().encode("{}"))
        const target = new InMemoryOpfs()
        const restored = await LongRecordingBundleAdapter.restoreFromFolder(target, folder)
        expect(restored).toHaveLength(0)
    })

    it("round-trips both encode-side and decode-side: classify → write → restore", async () => {
        await recordOnSource(opfs, RECORDING_UUID, 4)
        await recordOnSource(opfs, OTHER_RECORDING_UUID, 8)
        const classification = await LongRecordingBundleAdapter.classifyAudioFileBoxes(opfs, [
            {uuid: UUID.parse(SAMPLE_UUID)},
            {uuid: UUID.parse(RECORDING_UUID)},
            {uuid: UUID.parse(OTHER_RECORDING_UUID)}
        ])
        const folder = new FolderDouble()
        for (const ref of classification.longRecordings) {
            const subFolder = new FolderDouble()
            await LongRecordingBundleAdapter.writeIntoFolder(opfs, ref, subFolder)
            for (const [relative, bytes] of subFolder.files) {
                folder.file(`${UUID.toString(ref.uuid)}/${relative}`, bytes)
            }
        }
        const target = new InMemoryOpfs()
        const restored = await LongRecordingBundleAdapter.restoreFromFolder(target, folder)
        expect(new Set(restored)).toEqual(new Set([RECORDING_UUID, OTHER_RECORDING_UUID]))
        const first = (await LongRecordingStorage.create(RECORDING_UUID, target).readManifest()).unwrap()
        const second = (await LongRecordingStorage.create(OTHER_RECORDING_UUID, target).readManifest()).unwrap()
        expect(first.totalFrames).toBeGreaterThan(0)
        expect(second.totalFrames).toBeGreaterThan(first.totalFrames - 1)
    })
})
