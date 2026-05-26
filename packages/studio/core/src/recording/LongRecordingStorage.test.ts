import {beforeEach, describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {LongRecordingManifest, LongRecordingSource} from "./LongRecordingManifest"
import {LongRecordingStorage} from "./LongRecordingStorage"

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

    async exists(path: string): Promise<boolean> {
        const normalized = normalize(path)
        if (this.files.has(normalized)) {return true}
        const prefix = normalized === "" ? "" : `${normalized}/`
        for (const key of this.files.keys()) {
            if (key.startsWith(prefix) && key !== normalized) {return true}
        }
        return false
    }

    async delete(path: string): Promise<void> {
        const normalized = normalize(path)
        if (normalized === "") {
            this.files.clear()
            return
        }
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

const TEST_UUID = UUID.asString("00000000-0000-4000-8000-000000000010")
const OTHER_UUID = UUID.asString("00000000-0000-4000-8000-000000000011")

const exampleSource = (): LongRecordingSource => ({
    kind: "test",
    label: "fake",
    requestedSampleRate: 48000,
    requestedChannels: 2,
    actualSampleRate: 48000,
    actualChannels: 2
})

const exampleManifest = () => LongRecordingManifest.create({
    recordingId: TEST_UUID,
    now: 1000,
    sampleRate: 48000,
    numberOfChannels: 2,
    framesPerChunk: 24000,
    source: exampleSource()
})

let opfs: InMemoryOpfs

beforeEach(() => {opfs = new InMemoryOpfs()})

describe("LongRecordingStorage", () => {
    it("writes the manifest at <root>/<recordingId>/manifest.json", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        await storage.writeManifest(exampleManifest())
        expect(opfs.files.has(`${LongRecordingStorage.ROOT}/${TEST_UUID}/manifest.json`)).toBe(true)
    })

    it("reads back the manifest it wrote", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        const manifest = exampleManifest()
        await storage.writeManifest(manifest)
        const decoded = await storage.readManifest()
        expect(decoded.nonEmpty()).toBe(true)
        expect(decoded.unwrap().recordingId).toBe(manifest.recordingId)
    })

    it("returns Option.None when the manifest is missing or corrupt", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        expect((await storage.readManifest()).isEmpty()).toBe(true)
        await opfs.write(`${LongRecordingStorage.ROOT}/${TEST_UUID}/manifest.json`, new TextEncoder().encode("garbage"))
        expect((await storage.readManifest()).isEmpty()).toBe(true)
    })

    it("writes chunks under <root>/<recordingId>/chunks/ as zero-padded names", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        const bytes = new Uint8Array(8)
        await storage.writeChunk(7, bytes)
        expect(opfs.files.has(`${LongRecordingStorage.ROOT}/${TEST_UUID}/chunks/000007.pcm`)).toBe(true)
    })

    it("reads chunks back by index", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        const data = new Uint8Array([1, 2, 3, 4])
        await storage.writeChunk(3, data)
        expect(Array.from(await storage.readChunk(3))).toEqual([1, 2, 3, 4])
    })

    it("lists chunk probes sorted by index", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        await storage.writeChunk(2, new Uint8Array(10))
        await storage.writeChunk(0, new Uint8Array(20))
        await storage.writeChunk(1, new Uint8Array(15))
        const probes = await storage.listChunkProbes()
        expect(probes.map(probe => probe.index)).toEqual([0, 1, 2])
        expect(probes.map(probe => probe.bytes)).toEqual([20, 15, 10])
    })

    it("returns an empty probe list when the chunks dir does not exist yet", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        const probes = await storage.listChunkProbes()
        expect(probes).toEqual([])
    })

    it("delete removes only the recording's directory tree", async () => {
        const storage = LongRecordingStorage.create(TEST_UUID, opfs)
        const otherStorage = LongRecordingStorage.create(OTHER_UUID, opfs)
        await storage.writeManifest(exampleManifest())
        await storage.writeChunk(0, new Uint8Array([1]))
        await otherStorage.writeManifest(LongRecordingManifest.create({
            recordingId: OTHER_UUID,
            now: 0,
            sampleRate: 48000,
            numberOfChannels: 1,
            framesPerChunk: 24000,
            source: exampleSource()
        }))
        await storage.delete()
        expect(opfs.files.has(`${LongRecordingStorage.ROOT}/${TEST_UUID}/manifest.json`)).toBe(false)
        expect(opfs.files.has(`${LongRecordingStorage.ROOT}/${OTHER_UUID}/manifest.json`)).toBe(true)
    })

    it("listAll returns all known recording ids", async () => {
        await LongRecordingStorage.create(TEST_UUID, opfs).writeManifest(exampleManifest())
        await LongRecordingStorage.create(OTHER_UUID, opfs).writeManifest(LongRecordingManifest.create({
            recordingId: OTHER_UUID,
            now: 0,
            sampleRate: 48000,
            numberOfChannels: 1,
            framesPerChunk: 24000,
            source: exampleSource()
        }))
        const all = await LongRecordingStorage.listAll(opfs)
        expect(new Set(all)).toEqual(new Set([TEST_UUID, OTHER_UUID]))
    })
})
