import {afterEach, describe, expect, it, vi} from "vitest"
import {AudioData} from "./audio-data"
import {WavFile} from "./wav-file"

const chunk = (id: string, bytes: Uint8Array): Uint8Array => {
    const result = new Uint8Array(8 + bytes.length + bytes.length % 2)
    const view = new DataView(result.buffer)
    for (let i = 0; i < 4; i++) {result[i] = id.charCodeAt(i)}
    view.setUint32(4, bytes.length, true)
    result.set(bytes, 8)
    return result
}
const wav = (format = 3, channels = 1, bits = 32, data = new Uint8Array(4), junk = false): ArrayBuffer => {
    const fmt = new Uint8Array(16)
    const view = new DataView(fmt.buffer)
    view.setUint16(0, format, true)
    view.setUint16(2, channels, true)
    view.setUint32(4, 48000, true)
    view.setUint32(8, 48000 * channels * bits / 8, true)
    view.setUint16(12, channels * bits / 8, true)
    view.setUint16(14, bits, true)
    const chunks = [chunk("fmt ", fmt), ...(junk ? [chunk("JUNK", new Uint8Array([7]))] : []), chunk("data", data)]
    const buffer = new ArrayBuffer(12 + chunks.reduce((sum, bytes) => sum + bytes.length, 0))
    const header = new DataView(buffer)
    header.setUint32(0, 0x46464952, true)
    header.setUint32(4, buffer.byteLength - 8, true)
    header.setUint32(8, 0x45564157, true)
    let offset = 12
    for (const bytes of chunks) {new Uint8Array(buffer).set(bytes, offset); offset += bytes.length}
    return buffer
}
const floats = (...samples: number[]): Uint8Array => {
    const result = new Uint8Array(samples.length * 4)
    samples.forEach((sample, index) => new DataView(result.buffer).setFloat32(index * 4, sample, true))
    return result
}

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})

describe("WAV decoding bounds", () => {
    it.each([0, 4, 11])("rejects a %i-byte RIFF header", length => {
        expect(() => WavFile.decodeFloats(new ArrayBuffer(length))).toThrow("Invalid WAV")
    })
    it.each([0, 3, 0xffffffff])("rejects invalid RIFF size %i", size => {
        const buffer = wav()
        new DataView(buffer).setUint32(4, size, true)
        expect(() => WavFile.decodeFloats(buffer)).toThrow("Invalid WAV")
    })
    it.each([0x80000000, 0xffffffff, 100])("rejects out-of-bounds chunk size %i", size => {
        const buffer = wav()
        new DataView(buffer).setUint32(16, size, true)
        expect(() => WavFile.decodeFloats(buffer)).toThrow("Invalid WAV")
    })
    it("rejects short fmt and data chunks before allocation", () => {
        const create = vi.spyOn(AudioData, "create")
        const shortFmt = wav()
        new DataView(shortFmt).setUint32(16, 14, true)
        expect(() => WavFile.decodeFloats(shortFmt)).toThrow("Invalid WAV")
        const shortData = wav().slice(0, -2)
        new DataView(shortData).setUint32(4, shortData.byteLength - 8, true)
        expect(() => WavFile.decodeFloats(shortData)).toThrow("Invalid WAV")
        expect(create).not.toHaveBeenCalled()
    })
    it("rejects a partial chunk header and missing odd-byte padding", () => {
        const partial = wav().slice(0, -1)
        new DataView(partial).setUint32(4, partial.byteLength - 8, true)
        new DataView(partial).setUint32(40, 0, true)
        expect(() => WavFile.decodeFloats(partial)).toThrow("Invalid WAV")
        const odd = wav(1, 1, 24, new Uint8Array(3)).slice(0, -1)
        new DataView(odd).setUint32(4, odd.byteLength - 8, true)
        expect(() => WavFile.decodeFloats(odd)).toThrow("Invalid WAV")
    })
    it.each([[0, 0], [2, 0], [2, 4]])("rejects channels %i / alignment %i", (channels, alignment) => {
        vi.spyOn(AudioData, "create").mockImplementation(() => {throw new Error("allocation reached")})
        const buffer = wav()
        const view = new DataView(buffer)
        view.setUint16(22, channels, true)
        view.setUint16(32, alignment, true)
        expect(() => WavFile.decodeFloats(buffer)).toThrow("Invalid WAV")
    })
    it("rejects zero rate, unsupported format and incomplete frames before allocation", () => {
        const create = vi.spyOn(AudioData, "create")
        const zeroRate = wav()
        new DataView(zeroRate).setUint32(24, 0, true)
        expect(() => WavFile.decodeFloats(zeroRate)).toThrow("Invalid WAV")
        expect(() => WavFile.decodeFloats(wav(3, 2, 32, floats(0.5)))).toThrow("Invalid WAV")
        expect(() => WavFile.decodeFloats(wav(2))).toThrow("Unsupported WAV")
        expect(create).not.toHaveBeenCalled()
    })
    it.each([16, 24])("decodes valid %i-bit PCM", bits => {
        const data = bits === 16 ? new Uint8Array([0, 64]) : new Uint8Array([0, 0, 64])
        expect(WavFile.decodeFloats(wav(1, 1, bits, data)).frames[0][0]).toBe(0.5)
    })
})

describe("word-aligned float chunks", () => {
    it.each([1, 2])("decodes %i channels with a padded odd JUNK chunk", channels => {
        const data = floats(...(channels === 1 ? [0.5, -0.25] : [0.5, -0.5, 0.25, -0.25]))
        const aligned = WavFile.decodeFloats(wav(3, channels, 32, data))
        const unaligned = WavFile.decodeFloats(wav(3, channels, 32, data, true))
        expect(unaligned.frames).toEqual(aligned.frames)
        expect(unaligned.frames[0][0]).toBe(0.5)
    })
})

describe.each([WavFile.encodeInts16, WavFile.encodeFloats])("classic RIFF encoding", encode => {
    const audio = (length = 2) => ({sampleRate: 48000, length, numberOfChannels: 1,
        getChannelData: vi.fn(() => new Float32Array([0.5, -0.5]))})
    it.each([-1, 0.5, NaN, Infinity])("rejects invalid frame limit %s", limit => {
        expect(() => encode(audio(), limit)).toThrow("Invalid WAV")
    })
    it("rejects oversized metadata before allocation or channel reads", () => {
        const input = audio(0x100000000)
        const allocate = vi.fn(function () {throw new Error("allocation reached")})
        vi.stubGlobal("ArrayBuffer", allocate)
        expect(() => encode(input)).toThrow("WAV export too large")
        expect(allocate).not.toHaveBeenCalled()
        expect(input.getChannelData).not.toHaveBeenCalled()
    })
    it("checks the exact largest representable frame count", () => {
        const bytes = encode === WavFile.encodeInts16 ? 2 : 4
        const maxFrames = Math.floor((0xffffffff - 36) / bytes)
        const allocate = vi.fn(function () {throw new Error("allocation reached")})
        vi.stubGlobal("ArrayBuffer", allocate)
        expect(() => encode(audio(maxFrames + 1))).toThrow("WAV export too large")
        expect(allocate).not.toHaveBeenCalled()
        expect(() => encode(audio(maxFrames))).toThrow("allocation reached")
        expect(allocate).toHaveBeenCalledWith(44 + maxFrames * bytes)
    })
    it.each([-1, 0.5, NaN, Infinity])("rejects invalid source frame count %s", length => {
        expect(() => encode(audio(length))).toThrow("Invalid WAV")
    })
    it("encodes ordinary audio and respects a zero/short frame limit", () => {
        const decoded = WavFile.decodeFloats(encode(audio(), 1))
        expect(decoded.numberOfFrames).toBe(1)
        expect(decoded.frames[0][0]).toBeCloseTo(0.5, 4)
        expect(WavFile.decodeFloats(encode(audio(), 0)).numberOfFrames).toBe(0)
    })
})
