import {beforeEach, describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "./LongRecordingMedia"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {LongRecordingSource} from "./LongRecordingManifest"

const TEST_UUID = UUID.asString("00000000-0000-4000-8000-000000000030")

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

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "media",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

const channelOf = (length: number, value: number): Float32Array => {
    const data = new Float32Array(length)
    data.fill(value)
    return data
}

let opfs: InMemoryOpfs
let storage: LongRecordingStorage

beforeEach(() => {
    opfs = new InMemoryOpfs()
    storage = LongRecordingStorage.create(TEST_UUID, opfs)
})

const recordOneChunkSession = async (overrides: {framesPerChunk?: number, channels?: number} = {}) => {
    const framesPerChunk = overrides.framesPerChunk ?? 4
    const channels = overrides.channels ?? 2
    let tick = 1000
    const session = new LongRecordingSession({
        storage,
        sampleRate: 48000,
        numberOfChannels: channels,
        framesPerChunk,
        source: exampleSource(),
        overviewSamplesPerBin: 2,
        now: () => tick++
    })
    await session.arm()
    const channelArrays: Array<Float32Array> = []
    for (let index = 0; index < channels; index++) {
        channelArrays.push(channelOf(framesPerChunk, index === 0 ? 0.5 : -0.5))
    }
    session.appendQuantum(channelArrays)
    await session.stop()
    return session
}

describe("LongRecordingMediaReference", () => {
    it("derives metadata from the manifest without re-reading audio", () => {
        const session = new LongRecordingSession({
            storage,
            sampleRate: 48000,
            numberOfChannels: 2,
            framesPerChunk: 4,
            source: exampleSource(),
            now: () => 1
        })
        const reference = LongRecordingMediaReference.fromManifest(session.manifest)
        expect(reference.kind).toBe("long-recording")
        expect(reference.recordingId).toBe(TEST_UUID)
        expect(reference.sampleRate).toBe(48000)
        expect(reference.numberOfChannels).toBe(2)
        expect(reference.durationSeconds).toBe(0)
        expect(reference.framesPerChunk).toBe(4)
        expect(reference.state).toBe("active")
    })

    it("load() returns Option.None when the manifest is missing", async () => {
        const loaded = await LongRecordingMediaReference.load(TEST_UUID, opfs)
        expect(loaded.isEmpty()).toBe(true)
    })

    it("load() resolves a reference from a persisted recording", async () => {
        await recordOneChunkSession()
        const reference = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        expect(reference.totalFrames).toBe(4)
        expect(reference.durationSeconds).toBeCloseTo(4 / 48000)
    })
})

describe("LongRecordingMediaAccess", () => {
    it("locateFrame maps frame indexes to chunk index + intra-chunk offset", () => {
        const reference: LongRecordingMediaReference = {
            kind: "long-recording",
            recordingId: TEST_UUID,
            sampleRate: 48000,
            numberOfChannels: 1,
            durationSeconds: 1,
            totalFrames: 48000,
            framesPerChunk: 24000,
            overviewSamplesPerBin: 256,
            state: "stopped"
        }
        const access = LongRecordingMediaAccess.create(reference, storage)
        expect(access.locateFrame(0)).toEqual({chunkIndex: 0, chunkFrameOffset: 0})
        expect(access.locateFrame(24000)).toEqual({chunkIndex: 1, chunkFrameOffset: 0})
        expect(access.locateFrame(36000)).toEqual({chunkIndex: 1, chunkFrameOffset: 12000})
    })

    it("locateSeconds maps to frame index and then chunk position", () => {
        const reference: LongRecordingMediaReference = {
            kind: "long-recording",
            recordingId: TEST_UUID,
            sampleRate: 48000,
            numberOfChannels: 1,
            durationSeconds: 1,
            totalFrames: 48000,
            framesPerChunk: 24000,
            overviewSamplesPerBin: 256,
            state: "stopped"
        }
        const access = LongRecordingMediaAccess.create(reference, storage)
        expect(access.locateSeconds(0.25)).toEqual({chunkIndex: 0, chunkFrameOffset: 12000})
        expect(access.locateSeconds(0.5)).toEqual({chunkIndex: 1, chunkFrameOffset: 0})
    })

    it("readChunkSamples deinterleaves the on-disk channel data", async () => {
        await recordOneChunkSession({framesPerChunk: 4, channels: 2})
        const reference = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        const access = LongRecordingMediaAccess.create(reference, storage)
        const samples = await access.readChunkSamples(0)
        expect(samples).toHaveLength(2)
        expect(Array.from(samples[0])).toEqual([0.5, 0.5, 0.5, 0.5])
        expect(Array.from(samples[1])).toEqual([-0.5, -0.5, -0.5, -0.5])
    })

    it("readOverviewBins reads min/max bins per chunk without loading raw audio", async () => {
        await recordOneChunkSession({framesPerChunk: 4, channels: 2})
        const reference = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        const access = LongRecordingMediaAccess.create(reference, storage)
        const bins = await access.readOverviewBins()
        expect(bins.length).toBeGreaterThan(0)
        const channel0Bins = bins.filter(bin => bin.channel === 0)
        const channel1Bins = bins.filter(bin => bin.channel === 1)
        expect(channel0Bins.length).toBeGreaterThan(0)
        expect(channel1Bins.length).toBeGreaterThan(0)
        for (const bin of channel0Bins) {
            expect(bin.min).toBeCloseTo(0.5, 2)
            expect(bin.max).toBeCloseTo(0.5, 2)
        }
        for (const bin of channel1Bins) {
            expect(bin.min).toBeCloseTo(-0.5, 2)
            expect(bin.max).toBeCloseTo(-0.5, 2)
        }
    })
})
