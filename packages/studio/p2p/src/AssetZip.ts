import {readZipEntry, ZIP_LIMITS, ZipLimits} from "@opendaw/lib-runtime"
import JSZip from "jszip"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {SampleMetaData, SoundfontMetaData} from "@opendaw/studio-adapters"

export namespace AssetZip {
    export const packSample = async (wavBytes: ArrayBuffer, meta: SampleMetaData): Promise<ArrayBuffer> => {
        const zip = new JSZip()
        zip.file("audio.wav", wavBytes)
        zip.file("meta.json", JSON.stringify(meta))
        return zip.generateAsync({type: "arraybuffer"})
    }

    export const unpackSample = async (zipBytes: ArrayBuffer, limits: ZipLimits = ZIP_LIMITS): Promise<[AudioData, SampleMetaData]> => {
        const zip = await JSZip.loadAsync(zipBytes)
        if (Object.keys(zip.files).length > limits.entries) {throw new Error("Archive entry limit exceeded")}
        const budget = {remaining: limits.total}
        const metaJson = new TextDecoder().decode(await readZipEntry(zip.file("meta.json")!, limits.metadata, budget))
        const wavBytes = (await readZipEntry(zip.file("audio.wav")!, limits.media, budget)).buffer as ArrayBuffer
        const audioData = WavFile.decodeFloats(wavBytes)
        const meta = SampleMetaData.parse(JSON.parse(metaJson))
        return [audioData, meta]
    }

    export const packSoundfont = async (sf2Bytes: ArrayBuffer, meta: SoundfontMetaData): Promise<ArrayBuffer> => {
        const zip = new JSZip()
        zip.file("soundfont.sf2", sf2Bytes)
        zip.file("meta.json", JSON.stringify(meta))
        return zip.generateAsync({type: "arraybuffer"})
    }

    export const unpackSoundfont = async (zipBytes: ArrayBuffer, limits: ZipLimits = ZIP_LIMITS): Promise<[ArrayBuffer, SoundfontMetaData]> => {
        const zip = await JSZip.loadAsync(zipBytes)
        if (Object.keys(zip.files).length > limits.entries) {throw new Error("Archive entry limit exceeded")}
        const budget = {remaining: limits.total}
        const metaJson = new TextDecoder().decode(await readZipEntry(zip.file("meta.json")!, limits.metadata, budget))
        const sf2Bytes = (await readZipEntry(zip.file("soundfont.sf2")!, limits.media, budget)).buffer as ArrayBuffer
        const meta = SoundfontMetaData.parse(JSON.parse(metaJson))
        return [sf2Bytes, meta]
    }
}
