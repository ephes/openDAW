import {afterEach, expect, it, vi} from "vitest"
import {ByteArrayInput, ByteArrayOutput} from "@opendaw/lib-std"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import {Peaks, SamplePeaks} from "./Peaks"
import {SamplePeakWorker} from "./SamplePeakWorker"
import {SamplePeakProtocol} from "./SamplePeakProtocol"
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
const generate = async (frames: Float32Array[], shifts: Uint8Array) => {
    let protocol!: SamplePeakProtocol
    vi.spyOn(Communicator, "executor").mockImplementation((_messenger, implementation) => {
        protocol = implementation as SamplePeakProtocol
        return {} as ReturnType<typeof Communicator.executor>
    })
    SamplePeakWorker.install({channel: () => ({})} as unknown as Messenger)
    return SamplePeaks.from(new ByteArrayInput(await protocol.generateAsync(() => {}, shifts, frames, frames[0].length, frames.length)))
}
for (const count of [0, 1, 1000, 1200, 1201]) {
    it(`generates and roundtrips ${count} audio frames through the real protocol`, async () => {
        const frames = new Float32Array(count).fill(0.25)
        const peaks = await generate([frames], SamplePeaks.findBestFit(count))
        expect(peaks.numFrames).toBe(count); expect(peaks.numChannels).toBe(1)
        expect(frames[0] ?? 0).toBe(count ? 0.25 : 0)
        if (count <= 1200) {expect(peaks.stages).toHaveLength(0); expect(peaks.nearest(10)).toBe(null)}
    })
}
for (const length of [3, 5, 9, 16]) {
    it(`keeps final extrema at each stage for ${length} frames and two channels`, async () => {
        const a = new Float32Array(length).fill(1); a[length - 1] = 9
        const b = new Float32Array(length).fill(-1); b[length - 1] = -9
        const peaks = await generate([a, b], new Uint8Array([1, 2, 3]))
        for (const stage of peaks.stages) {
            const index = stage.dataOffset + stage.numPeaks - 1
            expect(Peaks.unpack(peaks.data[0][index], 1)).toBe(9)
            expect(Peaks.unpack(peaks.data[1][index], 0)).toBe(-9)
        }
    })
}
it("serializes exactly two nonzero-offset channel views", () => {
    const backing = new Int32Array([111, 222, 333, 444, 555, 666])
    const peaks = new SamplePeaks([new Peaks.Stage(1, 2, 0)], [backing.subarray(1, 3), backing.subarray(3, 5)], 3, 2)
    const restored = SamplePeaks.from(new ByteArrayInput(peaks.toArrayBuffer()))
    expect([...restored.data[0]]).toEqual([222, 333]); expect([...restored.data[1]]).toEqual([444, 555])
})
const fixture = (offset = 0, shift = 1, frames = 2, channels = 1, bytes = 4, peaks = 1) => {
    const out = ByteArrayOutput.create(); out.writeString("PEAKS"); out.writeInt(1)
    for (const value of [offset, peaks, shift, 0, 1, bytes]) {out.writeInt(value)}
    out.writeInt(0); out.writeInt(frames); out.writeInt(channels)
    return out.toArrayBuffer()
}
for (const args of [[1, 1, 2, 1], [0, 31, 2, 1], [0, 1, 5, 1], [0, 1, 2, 2], [0, 1, 2, 1, 3]]) {
    it(`rejects inconsistent peak shape ${args}`, () => expect(() => SamplePeaks.from(new ByteArrayInput(fixture(args[0], args[1], args[2], args[3], args[4])))).toThrow())
}
it("rejects huge declared data before allocation", () => {
    const input = fixture(0, 0, 0x1fffffff, 1, 0x7ffffffc, 0x1fffffff)
    const Native = Int8Array
    let allocated = false
    vi.stubGlobal("Int8Array", new Proxy(Native, {construct(target, args) {
        if (typeof args[0] === "number" && args[0] > 1024) {allocated = true; throw new Error("allocation guard")}
        return Reflect.construct(target, args)
    }}))
    expect(() => SamplePeaks.from(new ByteArrayInput(input))).toThrow()
    expect(allocated).toBe(false)
})

it("roundtrips more than 32 generated channels without an arbitrary parser cap", async () => {
    const peaks = await generate(Array.from({length: 33}, () => new Float32Array([0.25])), new Uint8Array(0))
    expect(peaks.numChannels).toBe(33)
    expect(peaks.data).toHaveLength(33)
})
it("rejects a huge stage count before reading stage records", () => {
    const out = ByteArrayOutput.create(); out.writeString("PEAKS"); out.writeInt(0x7fffffff)
    const position = out.toArrayBuffer().byteLength
    for (let i = 0; i < 8; i++) {out.writeInt(0)}
    const input = new ByteArrayInput(out.toArrayBuffer())
    expect(() => SamplePeaks.from(input)).toThrow()
    expect(input.position).toBe(position)
})
it("rejects huge channel counts before allocating channel buffers", () => {
    const out = ByteArrayOutput.create(); out.writeString("PEAKS"); out.writeInt(0); out.writeInt(0x7fffffff)
    out.writeInt(0); out.writeInt(0); out.writeInt(0)
    let allocated = false
    const Native = Int8Array
    vi.stubGlobal("Int8Array", new Proxy(Native, {construct(target, args) {allocated = true; return Reflect.construct(target, args)}}))
    expect(() => SamplePeaks.from(new ByteArrayInput(out.toArrayBuffer()))).toThrow()
    expect(allocated).toBe(false)
})
