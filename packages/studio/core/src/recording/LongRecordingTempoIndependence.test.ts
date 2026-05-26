import {beforeEach, describe, expect, it} from "vitest"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import {ConstantTempoMap, PPQN, TimeBase, TimeBaseConverter} from "@opendaw/lib-dsp"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {LongRecordingMediaAccess, LongRecordingMediaReference} from "./LongRecordingMedia"
import {LongRecordingSession} from "./LongRecordingSession"
import {LongRecordingStorage} from "./LongRecordingStorage"
import {LongRecordingSource} from "./LongRecordingManifest"

const TEST_UUID = UUID.asString("00000000-0000-4000-8000-000000000040")

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
    label: "podcast",
    requestedSampleRate: 48000,
    requestedChannels: 1,
    actualSampleRate: 48000,
    actualChannels: 1
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

describe("Long recording is tempo-independent", () => {
    it("media reference duration in seconds is unaffected by BPM changes", async () => {
        const session = new LongRecordingSession({
            storage,
            sampleRate: 48000,
            numberOfChannels: 1,
            framesPerChunk: 48000,
            source: exampleSource(),
            now: () => 1
        })
        await session.arm()
        for (let pass = 0; pass < 3; pass++) {
            session.appendQuantum([channelOf(48000, 0.1)])
        }
        await session.stop()
        const tempo = new DefaultObservableValue<number>(120)
        const tempoMap = new ConstantTempoMap(tempo)
        const reference = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        const baselineSeconds = reference.durationSeconds
        expect(baselineSeconds).toBeCloseTo(3, 5)
        tempo.setValue(60)
        expect(tempoMap.getTempoAt(0)).toBe(60)
        const reloaded = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        expect(reloaded.durationSeconds).toBeCloseTo(baselineSeconds, 5)
        tempo.setValue(180)
        const reloadedAgain = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        expect(reloadedAgain.durationSeconds).toBeCloseTo(baselineSeconds, 5)
    })

    it("a region with timeBase=Seconds reports the same duration before and after a BPM change", () => {
        const tempo = new DefaultObservableValue<number>(120)
        const tempoMap = new ConstantTempoMap(tempo)
        const duration = new DefaultObservableValue<number>(3.0)
        const timeBase = new DefaultObservableValue<string>(TimeBase.Seconds)
        const converter = TimeBaseConverter.aware(tempoMap, timeBase, duration)
        const positionAtBar4 = PPQN.Quarter * 4 * 4
        const baseline = converter.toSeconds(positionAtBar4)
        expect(baseline).toBe(3)
        tempo.setValue(60)
        expect(converter.toSeconds(positionAtBar4)).toBe(3)
        tempo.setValue(240)
        expect(converter.toSeconds(positionAtBar4)).toBe(3)
    })

    it("a region with timeBase=Musical stretches under tempo changes (sanity check of the negative)", () => {
        const tempo = new DefaultObservableValue<number>(120)
        const tempoMap = new ConstantTempoMap(tempo)
        const ppqnDuration = new DefaultObservableValue<number>(PPQN.Quarter * 4 * 4) // 4 bars
        const timeBase = new DefaultObservableValue<string>(TimeBase.Musical)
        const converter = TimeBaseConverter.aware(tempoMap, timeBase, ppqnDuration)
        const at120 = converter.toSeconds(0)
        expect(at120).toBeCloseTo(8, 5)
        tempo.setValue(60)
        const at60 = converter.toSeconds(0)
        expect(at60).toBeCloseTo(16, 5)
        expect(at60).not.toBeCloseTo(at120, 1)
    })

    it("chunk-to-frame mapping is sample-rate-bound, not BPM-bound", async () => {
        const session = new LongRecordingSession({
            storage,
            sampleRate: 48000,
            numberOfChannels: 1,
            framesPerChunk: 24000,
            source: exampleSource(),
            now: () => 1
        })
        await session.arm()
        for (let pass = 0; pass < 4; pass++) {
            session.appendQuantum([channelOf(24000, pass * 0.1)])
        }
        await session.stop()
        const reference = (await LongRecordingMediaReference.load(TEST_UUID, opfs)).unwrap()
        const access = LongRecordingMediaAccess.create(reference, storage)
        const tempo = new DefaultObservableValue<number>(120)
        new ConstantTempoMap(tempo) // construct + dispose to assert no implicit coupling
        const beforeChange = access.locateSeconds(1.0)
        tempo.setValue(60)
        const afterSlower = access.locateSeconds(1.0)
        tempo.setValue(240)
        const afterFaster = access.locateSeconds(1.0)
        expect(afterSlower).toEqual(beforeChange)
        expect(afterFaster).toEqual(beforeChange)
        expect(beforeChange.chunkIndex).toBe(2)
    })
})

