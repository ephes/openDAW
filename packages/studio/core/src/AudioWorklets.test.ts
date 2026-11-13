import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {RingBuffer} from "@opendaw/studio-adapters"
import {RenderQuantum} from "./RenderQuantum"

const nodeConstruct = vi.fn()
beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    nodeConstruct.mockClear()
    vi.stubGlobal("AudioWorkletNode", class {
        readonly channelCount: number
        constructor(readonly context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
            nodeConstruct(context, name, options)
            this.channelCount = options.channelCount ?? 2
        }
    })
})
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})
const context = (addModule = vi.fn().mockResolvedValue(undefined)) => ({audioWorklet: {addModule}, sampleRate: 48000}) as unknown as BaseAudioContext
const fixture = async () => {
    const {AudioWorklets} = await import("./AudioWorklets")
    AudioWorklets.install("synthetic-processors.js")
    return AudioWorklets
}

describe("worklet installations", () => {
    it("shares pending/completed installations and owners per context", async () => {
        const AudioWorklets = await fixture()
        const gate = Promise.withResolvers<void>()
        const addModule = vi.fn(() => gate.promise)
        const a = context(addModule)
        const b = context()
        const first = AudioWorklets.createFor(a)
        const second = AudioWorklets.createFor(a)
        const other = await AudioWorklets.createFor(b)
        expect(addModule).toHaveBeenCalledTimes(1)
        expect(() => AudioWorklets.get(a)).toThrow("Worklets not installed")
        gate.resolve()
        const [x, y] = await Promise.all([first, second])
        expect(x).toBe(y)
        expect(AudioWorklets.get(a)).toBe(x)
        expect(await AudioWorklets.createFor(a)).toBe(x)
        expect(addModule).toHaveBeenCalledTimes(1)
        expect(other).not.toBe(x)
        expect(AudioWorklets.get(b)).toBe(other)
    })
    it("evicts a rejected attempt and coalesces its retry", async () => {
        const AudioWorklets = await fixture()
        const failure = new Error("synthetic install failure")
        const addModule = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
        const a = context(addModule)
        const first = AudioWorklets.createFor(a)
        const second = AudioWorklets.createFor(a)
        await expect(first).rejects.toBe(failure)
        await expect(second).rejects.toBe(failure)
        const [x, y] = await Promise.all([AudioWorklets.createFor(a), AudioWorklets.createFor(a)])
        expect(x).toBe(y)
        expect(addModule).toHaveBeenCalledTimes(2)
    })
})

describe("recording geometry admission", () => {
    it.each([[0, 2], [-1, 2], [1.5, 2], [33, 2], [1, 0], [1, -1], [1, 1], [1, 1.5],
        [NaN, 2], [1, Infinity], [Number.MAX_SAFE_INTEGER, 2], [1, Number.MAX_SAFE_INTEGER], [32, 4097]])(
        "refuses channels=%s chunks=%s before allocation or node construction", async (channels, chunks) => {
            const AudioWorklets = await fixture()
            const allocations = vi.fn((target, args) => {
                if (args[0] > 64 * 1024 * 1024 + 8) {throw new Error("unexpected large allocation")}
                return Reflect.construct(target, args)
            })
            vi.stubGlobal("SharedArrayBuffer", new Proxy(SharedArrayBuffer, {construct: allocations}))
            expect(() => new AudioWorklets(context()).createRecording(channels, chunks)).toThrow(RangeError)
            expect(allocations).not.toHaveBeenCalled()
            expect(nodeConstruct).not.toHaveBeenCalled()
        })
    it.each([[1, 2], [32, 4096]])("admits channels=%s chunks=%s with the real writer/reader layout", async (channels, chunks) => {
        const AudioWorklets = await fixture()
        const node = new AudioWorklets(context()).createRecording(channels, chunks)
        const config = nodeConstruct.mock.calls[0][2].processorOptions as RingBuffer.Config
        expect(config.sab.byteLength).toBe(8 + channels * chunks * RenderQuantum * 4)
        expect(new Int32Array(config.sab, 0, 2)).toEqual(new Int32Array(2))
        const planes = Array.from({length: channels}, (_, i) => new Float32Array(RenderQuantum).fill((i + 1) / 32))
        RingBuffer.writer(config).write(planes)
        const audio = new Float32Array(config.sab, 8)
        planes.forEach((plane, i) => expect(audio.slice(i * RenderQuantum, (i + 1) * RenderQuantum)).toEqual(plane))
        await vi.advanceTimersByTimeAsync(1)
        expect(node.numberOfFrames).toBe(RenderQuantum)
        expect(Atomics.load(new Int32Array(config.sab, 0, 2), 1)).toBe(1)
        node.terminate()
    })
})
