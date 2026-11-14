import {afterEach, expect, it, vi} from "vitest"
import {WavFile} from "./wav-file"
import {AudioData} from "./audio-data"

afterEach(() => vi.unstubAllGlobals())
const valid = () => ({sampleRate: 48000, length: 3, numberOfChannels: 2,
    getChannelData: (channel: number) => new Float32Array(channel === 0 ? [0.25, -0.5, 1] : [-0.25, 0.5, -1])})

for (const encode of [WavFile.encodeFloats, WavFile.encodeInts16]) {
    it.each([
        {sampleRate: 0}, {sampleRate: NaN}, {sampleRate: Infinity}, {sampleRate: 0.5},
        {sampleRate: 0x100000000}, {sampleRate: 0xffffffff},
        {numberOfChannels: 0}, {numberOfChannels: -1}, {numberOfChannels: 0.5}, {numberOfChannels: 65536},
        {length: -1}, {length: 0.5}, {length: NaN},
        {getChannelData: (channel: number) => new Float32Array(channel === 0 ? 3 : 2)}
    ])(`${encode.name} refuses malformed source %j before output allocation`, fault => {
        const allocate = vi.fn(() => {throw new Error("output allocated")})
        vi.stubGlobal("ArrayBuffer", allocate)
        expect(() => encode({...valid(), ...fault})).toThrow(/WAV/i)
        expect(allocate).not.toHaveBeenCalled()
    })
    it(`${encode.name} checks all AudioData planes even for a short prefix`, () => {
        const data = {sampleRate: 48000, numberOfFrames: 3, numberOfChannels: 2,
            frames: [new Float32Array(3), new Float32Array(2)]} as unknown as AudioData
        expect(() => encode(data, 1)).toThrow(/WAV/i)
        expect(() => encode({...data, numberOfChannels: 1})).toThrow(/WAV/i)
        expect(() => encode({...data, frames: new Array(2)})).toThrow(/WAV/i)
    })
    it(`${encode.name} retains exact stereo prefix samples and headers`, () => {
        const buffer = encode(valid(), 2)
        const view = new DataView(buffer)
        const width = encode === WavFile.encodeFloats ? 4 : 2
        expect(buffer.byteLength).toBe(44 + 4 * width)
        expect(view.getUint16(22, true)).toBe(2)
        expect(view.getUint32(24, true)).toBe(48000)
        expect(view.getUint32(28, true)).toBe(48000 * 2 * width)
        expect(view.getUint16(32, true)).toBe(2 * width)
        expect(view.getUint32(40, true)).toBe(4 * width)
        const expected = [0.25, -0.25, -0.5, 0.5]
        expected.forEach((value, index) => {
            expect(width === 4 ? view.getFloat32(44 + index * width, true) : view.getInt16(44 + index * width, true))
                .toBe(width === 4 ? value : Math.round(value * 0x7fff))
        })
    })
}

for (const encode of [WavFile.encodeFloats, WavFile.encodeInts16]) {
    it.each([-1, 0.5, NaN, Infinity])(`${encode.name} refuses invalid prefix %s`, length => {
        expect(() => encode(valid(), length)).toThrow(/WAV/i)
    })
    it(`${encode.name} admits an empty prefix and AudioData sources`, () => {
        const data = AudioData.create(48000, 3, 2)
        const bytes = encode(data, 0)
        expect(bytes.byteLength).toBe(44)
        expect(new DataView(bytes).getUint32(40, true)).toBe(0)
    })
    it(`${encode.name} rejects RIFF overflow before allocating output`, () => {
        const allocate = vi.fn(() => {throw new Error("output allocated")})
        const audio = {sampleRate: 48000, length: 0x80000000, numberOfChannels: 1,
            getChannelData: () => ({length: 0x80000000}) as Float32Array}
        vi.stubGlobal("ArrayBuffer", allocate)
        expect(() => encode(audio)).toThrow(/RIFF/)
        expect(allocate).not.toHaveBeenCalled()
    })
}
