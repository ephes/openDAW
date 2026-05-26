import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {LongRecordingManifest, LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingRecovery} from "./LongRecordingRecovery"

const TEST_UUID = UUID.asString("00000000-0000-4000-8000-000000000002")

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "rec",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

const baseManifest = () => LongRecordingManifest.create({
    recordingId: TEST_UUID,
    now: 0,
    sampleRate: 48000,
    numberOfChannels: 2,
    framesPerChunk: 24000,
    source: exampleSource()
})

const expectedBytes = (frames: number, channels = 2, bytesPerSample = 4): number =>
    frames * channels * bytesPerSample

describe("LongRecordingRecovery.parseChunkIndex", () => {
    it("parses zero-padded indexes", () => {
        expect(LongRecordingRecovery.parseChunkIndex("000000.pcm")).toBe(0)
        expect(LongRecordingRecovery.parseChunkIndex("000123.pcm")).toBe(123)
        expect(LongRecordingRecovery.parseChunkIndex("123456.pcm")).toBe(123456)
    })

    it("rejects non-chunk file names", () => {
        expect(LongRecordingRecovery.parseChunkIndex("manifest.json")).toBeUndefined()
        expect(LongRecordingRecovery.parseChunkIndex("abc.pcm")).toBeUndefined()
        expect(LongRecordingRecovery.parseChunkIndex("00.pcm")).toBeUndefined()
    })
})

describe("LongRecordingRecovery.classify", () => {
    it("reports clean when manifest is stopped and every chunk matches", () => {
        let manifest = baseManifest()
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: expectedBytes(24000)}, 1)
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 1, frames: 24000, bytes: expectedBytes(24000)}, 2)
        manifest = LongRecordingManifest.withState(manifest, "stopped", 3)
        const report = LongRecordingRecovery.classify(manifest, [
            {index: 0, bytes: expectedBytes(24000)},
            {index: 1, bytes: expectedBytes(24000)}
        ])
        expect(report.overall).toBe("clean")
        expect(report.chunks.every(status => status.type === "clean")).toBe(true)
        expect(report.recoverableFrames).toBe(48000)
        expect(report.recoverableBytes).toBe(expectedBytes(48000))
    })

    it("reports recoverable when manifest is active but every chunk matches", () => {
        let manifest = baseManifest()
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: expectedBytes(24000)}, 1)
        const report = LongRecordingRecovery.classify(manifest, [
            {index: 0, bytes: expectedBytes(24000)}
        ])
        expect(report.overall).toBe("recoverable")
        expect(report.recoverableFrames).toBe(24000)
    })

    it("flags a missing chunk and stops counting recoverable frames at the gap", () => {
        let manifest = baseManifest()
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: expectedBytes(24000)}, 1)
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 1, frames: 24000, bytes: expectedBytes(24000)}, 2)
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 2, frames: 24000, bytes: expectedBytes(24000)}, 3)
        const report = LongRecordingRecovery.classify(manifest, [
            {index: 0, bytes: expectedBytes(24000)},
            {index: 2, bytes: expectedBytes(24000)}
        ])
        expect(report.overall).toBe("recoverable")
        const missing = report.chunks.find(status => status.type === "missing")
        expect(missing).toBeDefined()
        expect(report.recoverableFrames).toBe(24000)
    })

    it("flags a truncated chunk", () => {
        let manifest = baseManifest()
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: expectedBytes(24000)}, 1)
        const report = LongRecordingRecovery.classify(manifest, [
            {index: 0, bytes: expectedBytes(24000) - 4}
        ])
        const status = report.chunks[0]
        expect(status.type).toBe("truncated")
        expect(report.overall).toBe("corrupt")
        expect(report.recoverableFrames).toBe(0)
    })

    it("flags an oversized chunk as corrupt", () => {
        let manifest = baseManifest()
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: expectedBytes(24000)}, 1)
        const report = LongRecordingRecovery.classify(manifest, [
            {index: 0, bytes: expectedBytes(24000) + 4}
        ])
        expect(report.chunks[0].type).toBe("corrupt")
        expect(report.overall).toBe("corrupt")
    })

    it("flags extra chunks that are on disk but not in the manifest", () => {
        let manifest = baseManifest()
        manifest = LongRecordingManifest.withChunkAppended(manifest,
            {index: 0, frames: 24000, bytes: expectedBytes(24000)}, 1)
        manifest = LongRecordingManifest.withState(manifest, "stopped", 2)
        const report = LongRecordingRecovery.classify(manifest, [
            {index: 0, bytes: expectedBytes(24000)},
            {index: 1, bytes: expectedBytes(24000)}
        ])
        const extra = report.chunks.find(status => status.type === "extra")
        expect(extra).toBeDefined()
        if (extra !== undefined && extra.type === "extra") {
            expect(extra.index).toBe(1)
        }
        expect(report.overall).toBe("clean")
    })

    it("treats an empty failed manifest as failed", () => {
        const manifest = LongRecordingManifest.withState(baseManifest(), "failed", 1)
        const report = LongRecordingRecovery.classify(manifest, [])
        expect(report.overall).toBe("failed")
    })

    it("treats an empty active manifest as recoverable", () => {
        const report = LongRecordingRecovery.classify(baseManifest(), [])
        expect(report.overall).toBe("recoverable")
    })
})
