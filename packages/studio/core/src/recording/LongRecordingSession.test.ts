import {beforeEach, describe, expect, it} from "vitest"
import {isDefined, Nullable, tryCatch, UUID} from "@opendaw/lib-std"
import {LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingChunkBuffer} from "./LongRecordingChunkBuffer"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingRecovery} from "./LongRecordingRecovery"
import {InMemoryOpfs} from "./__test_support__/InMemoryOpfs"

const TEST_UUID = UUID.asString("00000000-0000-4000-8000-000000000020")

class FailingOpfs extends InMemoryOpfs {
    failWriteOn: Nullable<string> = null

    override async write(path: string, data: Uint8Array): Promise<void> {
        if (isDefined(this.failWriteOn) && path.endsWith(this.failWriteOn)) {
            throw new Error(`simulated write failure: ${path}`)
        }
        await super.write(path, data)
    }
}

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "synth",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

const channelOf = (length: number, value: number): Float32Array => {
    const arr = new Float32Array(length)
    arr.fill(value)
    return arr
}

let opfs: FailingOpfs
let storage: LongRecordingStorage

beforeEach(() => {
    opfs = new FailingOpfs()
    storage = LongRecordingStorage.create(TEST_UUID, opfs)
})

const makeSession = (overrides: Partial<{
    sampleRate: number
    numberOfChannels: number
    framesPerChunk: number
    maxPendingBytes: number
    now: () => number
}> = {}): LongRecordingSession => {
    let tick = 1000
    return new LongRecordingSession({
        storage,
        sampleRate: overrides.sampleRate ?? 48000,
        numberOfChannels: overrides.numberOfChannels ?? 1,
        framesPerChunk: overrides.framesPerChunk ?? 4,
        maxPendingBytes: overrides.maxPendingBytes,
        source: exampleSource(),
        now: overrides.now ?? (() => tick++)
    })
}

describe("LongRecordingSession", () => {
    it("arm() writes an initial active manifest", async () => {
        const session = makeSession()
        await session.arm()
        expect(session.sessionState).toBe("armed")
        const manifest = (await storage.readManifest()).unwrap()
        expect(manifest.state).toBe("active")
        expect(manifest.chunks).toHaveLength(0)
    })

    it("writes a full chunk and updates the manifest live", async () => {
        const session = makeSession()
        await session.arm()
        session.appendQuantum([channelOf(4, 0.5)])
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(session.sessionState).toBe("recording")
        const manifest = (await storage.readManifest()).unwrap()
        expect(manifest.chunks).toHaveLength(1)
        expect(manifest.totalFrames).toBe(4)
        const chunkBytes = await storage.readChunk(0)
        const decoded = LongRecordingChunkBuffer.deinterleave(chunkBytes, 1, 4)
        expect(Array.from(decoded[0])).toEqual([0.5, 0.5, 0.5, 0.5])
    })

    it("preserves channel order across multi-channel chunks", async () => {
        const session = makeSession({numberOfChannels: 2, framesPerChunk: 2})
        await session.arm()
        session.appendQuantum([channelOf(2, 1), channelOf(2, 2)])
        await session.stop()
        const chunkBytes = await storage.readChunk(0)
        const decoded = LongRecordingChunkBuffer.deinterleave(chunkBytes, 2, 2)
        expect(Array.from(decoded[0])).toEqual([1, 1])
        expect(Array.from(decoded[1])).toEqual([2, 2])
    })

    it("flushes a residual partial chunk on stop()", async () => {
        const session = makeSession({framesPerChunk: 4})
        await session.arm()
        session.appendQuantum([channelOf(3, 0.25)])
        await session.stop()
        expect(session.sessionState).toBe("stopped")
        const manifest = (await storage.readManifest()).unwrap()
        expect(manifest.state).toBe("stopped")
        expect(manifest.chunks).toHaveLength(1)
        expect(manifest.chunks[0].frames).toBe(3)
        expect(manifest.totalFrames).toBe(3)
    })

    it("reports progress events for each completed chunk", async () => {
        const session = makeSession({framesPerChunk: 2})
        const events: Array<{frames: number, chunks: number, bytes: number}> = []
        session.subscribeProgress(progress => events.push({
            frames: progress.frames,
            chunks: progress.chunks,
            bytes: progress.bytes
        }))
        await session.arm()
        session.appendQuantum([channelOf(4, 0)])
        await session.stop()
        expect(events).toEqual([
            {frames: 2, chunks: 1, bytes: 8},
            {frames: 4, chunks: 2, bytes: 16}
        ])
    })

    it("fails deterministically when the write backlog exceeds maxPendingBytes", async () => {
        const session = makeSession({framesPerChunk: 1, numberOfChannels: 1, maxPendingBytes: 8})
        await session.arm()
        session.appendQuantum([channelOf(16, 0.5)])
        expect(session.pendingBytes).toBeGreaterThan(8)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(session.sessionState).toBe("failed")
        expect(String(session.lastStorageError)).toContain("write backlog")
        session.appendQuantum([channelOf(4, 0.5)])
        expect(session.sessionState).toBe("failed")
    })

    it("does not append more chunks after stop", async () => {
        const session = makeSession({framesPerChunk: 4})
        await session.arm()
        session.appendQuantum([channelOf(4, 0.1)])
        await session.stop()
        const beforeChunks = (await storage.readManifest()).unwrap().chunks.length
        session.appendQuantum([channelOf(4, 0.2)])
        await new Promise(resolve => setTimeout(resolve, 0))
        const afterChunks = (await storage.readManifest()).unwrap().chunks.length
        expect(afterChunks).toBe(beforeChunks)
    })

    it("transitions to 'failed' and surfaces the error when a chunk write rejects", async () => {
        const session = makeSession({framesPerChunk: 4})
        const errors: unknown[] = []
        session.subscribeStorageErrors(error => errors.push(error))
        await session.arm()
        opfs.failWriteOn = "/chunks/000000.pcm"
        session.appendQuantum([channelOf(4, 0)])
        await new Promise(resolve => setTimeout(resolve, 0))
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(session.sessionState).toBe("failed")
        expect(errors.length).toBeGreaterThan(0)
        const manifestOption = await storage.readManifest()
        expect(manifestOption.nonEmpty()).toBe(true)
        expect(manifestOption.unwrap().state).toBe("failed")
    })

    it("produces a manifest that passes recovery as 'clean' after a successful stop", async () => {
        const session = makeSession({framesPerChunk: 2})
        await session.arm()
        session.appendQuantum([channelOf(4, 0)])
        await session.stop()
        const reloaded = (await storage.readManifest()).unwrap()
        const probes = await storage.listChunkProbes()
        const report = LongRecordingRecovery.classify(reloaded, probes)
        expect(report.overall).toBe("clean")
        expect(report.recoverableFrames).toBe(4)
    })

    it("enumerateExisting returns a handle per persisted recording", async () => {
        const session = makeSession({framesPerChunk: 4})
        await session.arm()
        session.appendQuantum([channelOf(4, 0)])
        await session.stop()
        const handles = await LongRecordingSession.enumerateExisting(opfs)
        expect(handles).toHaveLength(1)
        expect(handles[0].recordingId).toBe(TEST_UUID)
        expect(handles[0].state).toBe("stopped")
        expect(handles[0].chunkCount).toBe(1)
        expect(handles[0].totalFrames).toBe(4)
    })

    it("assertOpfsSupported throws when navigator.storage.getDirectory is missing", () => {
        const originalNavigator = globalThis.navigator
        Reflect.set(globalThis, "navigator", {})
        const result = tryCatch(() => LongRecordingSession.assertOpfsSupported())
        Reflect.set(globalThis, "navigator", originalNavigator)
        expect(result.status).toBe("failure")
        if (result.status === "failure") {
            expect(String(result.error)).toMatch(/OPFS is not available/)
        }
    })
})
