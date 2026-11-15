import {ByteArrayInput, Lazy, Progress, Provider, tryCatch, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {OpfsProtocol, Peaks, SamplePeaks} from "@opendaw/lib-fusion"
import {Sample, SampleMetaData} from "@opendaw/studio-adapters"
import {Workers} from "../Workers"
import {Storage} from "../Storage"
import {AudioData, WavFile} from "@opendaw/lib-dsp"

export namespace SampleStorage {
    export type NewSample = {
        uuid: UUID.Bytes,
        audio: AudioData,
        peaks: ArrayBuffer,
        meta: SampleMetaData
    }
}

export class SampleStorage extends Storage<Sample, SampleMetaData, SampleStorage.NewSample, [AudioData, Peaks, SampleMetaData]> {
    static readonly Folder = "samples/v2"

    @Lazy
    static get(): SampleStorage {return new SampleStorage()}

    private constructor() {super(SampleStorage.Folder)}

    async save(sample: SampleStorage.NewSample): Promise<void> {await this.#save(sample, false)}

    async saveOwned(sample: SampleStorage.NewSample): Promise<Provider<Promise<void>>> {return this.#save(sample, true)}

    async #save({uuid, audio, peaks, meta}: SampleStorage.NewSample, owned: boolean): Promise<Provider<Promise<void>>> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        const ownerPath = `${path}/import-owner`
        const token = UUID.toString(UUID.generate())
        return navigator.locks.request(`opendaw:storage:${this.folder}`, async () => {
            const existing = await Workers.Opfs.list(this.folder)
            if (existing.some(entry => entry.name === UUID.toString(uuid))) {
                // Validate and preserve a complete content-addressed asset. An existing
                // incomplete folder belongs to an earlier operation and needs repair.
                await this.load(uuid)
                const owner = await Promises.tryCatch(Workers.Opfs.read(ownerPath, 36))
                if (owner.status === "resolved") {await Workers.Opfs.delete(ownerPath)}
                else if (!(owner.error instanceof DOMException && owner.error.name === "NotFoundError")) {throw owner.error}
                return async () => {}
            }
            const data = new Uint8Array(WavFile.encodeFloats({
                frames: audio.frames.slice(),
                numberOfFrames: audio.numberOfFrames,
                numberOfChannels: audio.numberOfChannels,
                sampleRate: audio.sampleRate
            }))
            SamplePeaks.from(new ByteArrayInput(peaks))
            const result = await Promises.tryCatch((async () => {
                await Workers.Opfs.write(`${path}/audio.wav`, data)
                await Workers.Opfs.write(`${path}/peaks.bin`, new Uint8Array(peaks))
                if (owned) {await Workers.Opfs.write(ownerPath, new TextEncoder().encode(token))}
                await Workers.Opfs.write(`${path}/meta.json`, new TextEncoder().encode(JSON.stringify(meta)))
            })())
            if (result.status === "rejected") {
                const cleanup = await Promises.tryCatch(Workers.Opfs.delete(path))
                if (cleanup.status === "rejected") {console.warn("Sample import cleanup failed", cleanup.error)}
                throw result.error
            }
            return async () => navigator.locks.request(`opendaw:storage:${this.folder}`, async () => {
                if (!owned) {return}
                const owner = await Promises.tryCatch(Workers.Opfs.read(ownerPath, 36))
                if (owner.status === "rejected") {
                    if (owner.error instanceof DOMException && owner.error.name === "NotFoundError") {return}
                    throw owner.error
                }
                if (new TextDecoder().decode(owner.value) === token) {await Workers.Opfs.delete(path)}
            })
        })
    }

    async exists(uuid: UUID.Bytes): Promise<boolean> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        return Workers.Opfs.exists(path)
    }

    async updateSampleMeta(uuid: UUID.Bytes, meta: SampleMetaData): Promise<void> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        return navigator.locks.request(`opendaw:storage:${this.folder}`, async () => {
            // A stale editor must not recreate a metadata-only directory after delete.
            if (!await Workers.Opfs.exists(`${path}/audio.wav`)) {throw new Error("Sample is no longer available; refresh the library.")}
            const previous = JSON.parse(new TextDecoder().decode(await Workers.Opfs.read(`${path}/meta.json`, OpfsProtocol.ReadLimits.Metadata)))
            SampleMetaData.parse(previous)
            await Workers.Opfs.write(`${path}/meta.json`, new TextEncoder().encode(JSON.stringify(meta)))
        })
    }

    async loadMeta(uuid: UUID.Bytes): Promise<SampleMetaData> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        const bytes = await Workers.Opfs.read(`${path}/meta.json`, OpfsProtocol.ReadLimits.Metadata)
        return JSON.parse(new TextDecoder().decode(bytes))
    }

    async load(uuid: UUID.Bytes): Promise<[AudioData, Peaks, SampleMetaData]> {
        const path = `${this.folder}/${UUID.toString(uuid)}`
        const exactBuffer = (bytes: Uint8Array): ArrayBuffer =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const [audioBytes, peaksBytes, metaBytes] = await Promise.all([
            Workers.Opfs.read(`${path}/audio.wav`, OpfsProtocol.ReadLimits.Media),
            Workers.Opfs.read(`${path}/peaks.bin`, OpfsProtocol.ReadLimits.Media).catch(error => {
                if (error instanceof DOMException && error.name === "NotFoundError") {return new Uint8Array(0)}
                throw error
            }),
            Workers.Opfs.read(`${path}/meta.json`, OpfsProtocol.ReadLimits.Metadata)
        ])
        const decoded = WavFile.decodeFloats(exactBuffer(audioBytes))
        const audio: AudioData = {
            sampleRate: decoded.sampleRate,
            numberOfFrames: decoded.numberOfFrames,
            numberOfChannels: decoded.frames.length,
            frames: decoded.frames
        }
        const peaks = await this.#readOrRegeneratePeaks(path, peaksBytes, audio, exactBuffer)
        const meta: SampleMetaData = JSON.parse(new TextDecoder().decode(metaBytes))
        return [audio, peaks, meta]
    }

    async #readOrRegeneratePeaks(path: string,
                                 bytes: Uint8Array,
                                 audio: AudioData,
                                 exactBuffer: (bytes: Uint8Array) => ArrayBuffer): Promise<Peaks> {
        if (bytes.byteLength > 0) {
            const attempt = tryCatch(() => SamplePeaks.from(new ByteArrayInput(exactBuffer(bytes))))
            if (attempt.status === "success") {return attempt.value}
            console.warn(`peaks.bin is corrupted for '${path}' — regenerating`, attempt.error)
        } else {
            console.warn(`peaks.bin is empty for '${path}' — regenerating`)
        }
        const shifts = SamplePeaks.findBestFit(audio.numberOfFrames)
        const regenerated = await Workers.Peak.generateAsync(
            Progress.Empty, shifts, audio.frames, audio.numberOfFrames, audio.numberOfChannels) as ArrayBuffer
        await Workers.Opfs.write(`${path}/peaks.bin`, new Uint8Array(regenerated))
        return SamplePeaks.from(new ByteArrayInput(regenerated))
    }
}
