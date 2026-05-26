import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {LONG_RECORDING_SCHEMA_VERSION, LongRecordingManifest, LongRecordingSource} from "./LongRecordingManifest"

const TEST_UUID = UUID.asString("00000000-0000-4000-8000-000000000001")

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "test-source",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

describe("LongRecordingManifest", () => {
    it("creates an initial manifest in the active state with no chunks", () => {
        const manifest = LongRecordingManifest.create({
            recordingId: TEST_UUID,
            now: 1700000000000,
            sampleRate: 48000,
            numberOfChannels: 2,
            framesPerChunk: 24000,
            source: exampleSource()
        })
        expect(manifest.schema).toBe(LONG_RECORDING_SCHEMA_VERSION)
        expect(manifest.state).toBe("active")
        expect(manifest.chunks).toHaveLength(0)
        expect(manifest.totalFrames).toBe(0)
        expect(manifest.bytesPerSample).toBe(Float32Array.BYTES_PER_ELEMENT)
        expect(manifest.createdAt).toBe(1700000000000)
        expect(manifest.updatedAt).toBe(1700000000000)
    })

    it("appends a chunk and advances totalFrames + updatedAt", () => {
        const initial = LongRecordingManifest.create({
            recordingId: TEST_UUID,
            now: 1000,
            sampleRate: 48000,
            numberOfChannels: 1,
            framesPerChunk: 24000,
            source: exampleSource()
        })
        const next = LongRecordingManifest.withChunkAppended(initial,
            {index: 0, frames: 24000, bytes: 96000}, 1500)
        expect(next.chunks).toHaveLength(1)
        expect(next.totalFrames).toBe(24000)
        expect(next.updatedAt).toBe(1500)
        expect(initial.chunks).toHaveLength(0)
    })

    it("transitions state without losing chunk data", () => {
        let manifest = LongRecordingManifest.create({
            recordingId: TEST_UUID,
            now: 0,
            sampleRate: 48000,
            numberOfChannels: 2,
            framesPerChunk: 24000,
            source: exampleSource()
        })
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: 192000}, 100)
        manifest = LongRecordingManifest.withState(manifest, "stopped", 200)
        expect(manifest.state).toBe("stopped")
        expect(manifest.chunks).toHaveLength(1)
        expect(manifest.updatedAt).toBe(200)
    })

    it("computes expected chunk bytes from frames/channels/sample size", () => {
        expect(LongRecordingManifest.expectedChunkBytes(24000, 2, 4)).toBe(192000)
        expect(LongRecordingManifest.expectedChunkBytes(12000, 1, 4)).toBe(48000)
    })

    it("formats chunk file names with zero-padded indexes", () => {
        expect(LongRecordingManifest.chunkFileName(0)).toBe("000000.pcm")
        expect(LongRecordingManifest.chunkFileName(42)).toBe("000042.pcm")
        expect(LongRecordingManifest.chunkFileName(123456)).toBe("123456.pcm")
    })

    it("round-trips through encode/decode", () => {
        const manifest = LongRecordingManifest.withChunkAppended(
            LongRecordingManifest.create({
                recordingId: TEST_UUID,
                now: 1700000000000,
                sampleRate: 48000,
                numberOfChannels: 2,
                framesPerChunk: 24000,
                source: exampleSource()
            }),
            {index: 0, frames: 24000, bytes: 192000},
            1700000000500
        )
        const encoded = LongRecordingManifest.encode(manifest)
        const decoded = LongRecordingManifest.decode(encoded)
        expect(decoded.nonEmpty()).toBe(true)
        expect(decoded.unwrap()).toEqual(manifest)
    })

    it("rejects manifests with the wrong schema version", () => {
        const encoded = new TextEncoder().encode(JSON.stringify({
            schema: 99,
            recordingId: TEST_UUID,
            createdAt: 0,
            updatedAt: 0,
            state: "active",
            sampleRate: 48000,
            numberOfChannels: 2,
            framesPerChunk: 24000,
            bytesPerSample: 4,
            chunks: [],
            totalFrames: 0,
            source: exampleSource()
        }))
        expect(LongRecordingManifest.decode(encoded).isEmpty()).toBe(true)
    })

    it("rejects garbage input", () => {
        expect(LongRecordingManifest.decode(new TextEncoder().encode("not json")).isEmpty()).toBe(true)
        expect(LongRecordingManifest.decode(new TextEncoder().encode("[]")).isEmpty()).toBe(true)
    })

    it("rejects manifests with invalid chunk entries", () => {
        const encoded = new TextEncoder().encode(JSON.stringify({
            schema: LONG_RECORDING_SCHEMA_VERSION,
            recordingId: TEST_UUID,
            createdAt: 0,
            updatedAt: 0,
            state: "active",
            sampleRate: 48000,
            numberOfChannels: 2,
            framesPerChunk: 24000,
            bytesPerSample: 4,
            chunks: [{index: 0, frames: -1, bytes: 0}],
            totalFrames: 0,
            source: exampleSource()
        }))
        expect(LongRecordingManifest.decode(encoded).isEmpty()).toBe(true)
    })
})
