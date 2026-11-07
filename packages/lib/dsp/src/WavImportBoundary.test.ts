import {afterEach, expect, it, vi} from "vitest"
import {AudioData} from "./audio-data"
import {WavFile} from "./wav-file"
afterEach(() => vi.restoreAllMocks())
for (const fault of ["oversized data", "short format", "zero channels"]) {
    it(`rejects ${fault} before allocating decoded bundle audio`, () => {
        const data = AudioData.create(44100, 2, 1)
        const bytes = WavFile.encodeFloats(data)
        const view = new DataView(bytes)
        // encodeFloats writes canonical 44-byte RIFF/fmt/data headers.
        if (fault === "oversized data") {view.setUint32(40, 0x7fffffff, true)}
        if (fault === "short format") {view.setUint32(16, 8, true)}
        if (fault === "zero channels") {view.setUint16(22, 0, true); view.setUint16(32, 0, true)}
        const allocate = vi.spyOn(AudioData, "create").mockImplementation(() => {throw new Error("untrusted allocation")})
        expect(() => WavFile.decodeFloats(bytes)).toThrow(/WAV|alignment/)
        expect(allocate).not.toHaveBeenCalled()
    })
}
it("keeps valid synthetic float and PCM audio round trips", () => {
    const data = AudioData.create(44100, 2, 2)
    data.frames[0].set([0.25, -0.25]); data.frames[1].set([-0.5, 0.5])
    for (const bytes of [WavFile.encodeFloats(data), WavFile.encodeInts16(data)]) {
        const decoded = WavFile.decodeFloats(bytes)
        expect(decoded.numberOfFrames).toBe(2); expect(decoded.numberOfChannels).toBe(2)
        expect(decoded.frames[0][0]).toBeCloseTo(0.25, 4)
        expect(decoded.frames[1][1]).toBeCloseTo(0.5, 4)
    }
})

it("keeps complete frames and tolerates a truncated trailing unknown chunk", () => {
    const audio = AudioData.create(44100, 2, 1)
    const partial = WavFile.encodeFloats(audio)
    new DataView(partial).setUint32(40, 7, true)
    expect(WavFile.decodeFloats(partial).numberOfFrames).toBe(1)
    const valid = WavFile.encodeFloats(audio)
    const trailing = new Uint8Array(valid.byteLength + 10); trailing.set(new Uint8Array(valid))
    const tail = new DataView(trailing.buffer)
    tail.setUint32(valid.byteLength, 0x5453494c, true) // LIST
    tail.setUint32(valid.byteLength + 4, 12, true)
    expect(WavFile.decodeFloats(trailing.buffer).numberOfFrames).toBe(2)
})
