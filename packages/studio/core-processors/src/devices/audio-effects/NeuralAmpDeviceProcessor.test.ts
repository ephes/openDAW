import {beforeEach, expect, it, vi} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {EngineToClient, NeuralAmpDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {Block} from "../../processing"

const bridge = vi.hoisted(() => ({create: vi.fn(), from: vi.fn()}))
vi.mock("@opendaw/nam-wasm", () => ({createNamModule: bridge.create, NamWasmModule: {fromModule: bridge.from}}))
let NeuralAmp: typeof import("./NeuralAmpDeviceProcessor").NeuralAmpDeviceProcessor
const terminable = () => ({terminate() {}})
const block: Block = {index: 0, p0: 0, p1: 1, s0: 0, s1: 128, bpm: 120, flags: 0}
let nextId: number
let loaded: Set<number>
const wasm = {
    setSampleRate: vi.fn(), createInstance: vi.fn(() => nextId++),
    loadModel: vi.fn((id: number, _json: string) => {loaded.add(id); return true}),
    unloadModel: vi.fn((id: number) => {loaded.delete(id)}), destroyInstance: vi.fn(), reset: vi.fn(),
    process: vi.fn((id: number, input: Float32Array, output: Float32Array) => {
        if (!loaded.has(id)) throw new Error("processing unloaded instance")
        output.set(input)
    })
}
beforeEach(async () => {
    vi.restoreAllMocks(); vi.resetModules(); vi.clearAllMocks()
    Object.assign(globalThis, {sampleRate: 48000})
    nextId = 0; loaded = new Set()
    bridge.create.mockResolvedValue({}); bridge.from.mockReturnValue(wasm)
    wasm.unloadModel.mockImplementation((id: number) => {loaded.delete(id)})
    wasm.destroyInstance.mockImplementation(() => {})
    wasm.loadModel.mockImplementation((id: number) => {loaded.add(id); return true})
    NeuralAmp = (await import("./NeuralAmpDeviceProcessor")).NeuralAmpDeviceProcessor
})
function fixture(initialModel = "model", initialMono = true) {
    let model = initialModel
    let mono = initialMono
    let modelChanged = () => {}
    let monoChanged = (_field: {getValue(): boolean}) => {}
    const address = Address.compose(UUID.generate())
    const namedParameter = Object.fromEntries(Object.entries({inputGain: 0, outputGain: 0, mix: 1}).map(([name, value]) => [name, {
        address, getValue: () => value, subscribe: terminable, valueMapping: {x: (x: number) => x},
        field: {pointerHub: {catchupAndSubscribe: terminable}}
    }]))
    const adapter = {address, uuid: address.uuid, namedParameter, spectrum: address,
        getModelJson: () => model,
        modelField: {catchupAndSubscribe: (fn: () => void) => {modelChanged = fn; fn(); return terminable()}},
        monoField: {catchupAndSubscribe: (fn: typeof monoChanged) => {
            monoChanged = fn; fn({getValue: () => mono}); return terminable()
        }}
    } as unknown as NeuralAmpDeviceBoxAdapter
    const context = {engineToClient: {fetchNamWasm: vi.fn().mockResolvedValue(new ArrayBuffer(0))},
        broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: {register: terminable}, awaitResource: vi.fn()
    } as unknown as EngineContext
    const processor = new NeuralAmp(context, adapter)
    const input = new AudioBuffer()
    input.getChannel(0).fill(0.8); input.getChannel(1).fill(0.2)
    processor.setAudioSource(input)
    return {processor, context, input,
        model: (value: string) => {model = value; modelChanged()},
        mono: (value: boolean) => {mono = value; monoChanged({getValue: () => mono})}}
}
async function ready(context: EngineContext) {
    await NeuralAmp.fetchWasm(context.engineToClient)
    await Promise.resolve()
}
it("shares a rejected loader attempt, retries concurrently and caches success", async () => {
    const fetchNamWasm = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new ArrayBuffer(0))
    const client = {fetchNamWasm} as unknown as EngineToClient
    const failed = await Promise.allSettled([NeuralAmp.fetchWasm(client), NeuralAmp.fetchWasm(client)])
    expect(failed.map(x => x.status)).toEqual(["rejected", "rejected"])
    expect(fetchNamWasm).toHaveBeenCalledTimes(1)
    await Promise.all([NeuralAmp.fetchWasm(client), NeuralAmp.fetchWasm(client)])
    await NeuralAmp.fetchWasm(client)
    expect(fetchNamWasm).toHaveBeenCalledTimes(2)
    expect(bridge.create).toHaveBeenCalledTimes(1)
    expect(wasm.setSampleRate).toHaveBeenCalledWith(48000)
})
it.each([false, "throw"])("keeps usable mono when stereo admission fails (%s), then retries", async failure => {
    const f = fixture(); await ready(f.context)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    wasm.loadModel.mockImplementationOnce(() => {
        if (failure === "throw") throw new Error("bad right model")
        return false
    })
    f.mono(false)
    expect(() => f.processor.processAudio(block)).not.toThrow()
    expect(f.processor.audioOutput.getChannel(0)[0]).toBeCloseTo(0.5)
    expect(f.processor.audioOutput.getChannel(1)[0]).toBeCloseTo(0.5)
    expect(wasm.destroyInstance).toHaveBeenCalledWith(1)
    f.mono(false)
    f.processor.processAudio(block)
    expect(f.processor.audioOutput.getChannel(0)[0]).toBeCloseTo(0.8)
    expect(f.processor.audioOutput.getChannel(1)[0]).toBeCloseTo(0.2)
    expect(wasm.process.mock.calls.map(x => x[0])).not.toContain(1)
    f.processor.terminate(); error.mockRestore()
})
it.each([true, false])("attempts every owned release and preserves the first failure (base=%s)", async baseFails => {
    const f = fixture("model", false); await ready(f.context)
    const baseError = new Error("base teardown")
    const unloadError = new Error("left unload")
    const {AudioProcessor} = await import("../../AudioProcessor")
    const base = baseFails ? vi.spyOn(AudioProcessor.prototype, "terminate").mockImplementation(() => {throw baseError}) : undefined
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    wasm.unloadModel.mockImplementation(() => {throw unloadError})
    wasm.destroyInstance.mockImplementation(() => {throw new Error("destroy")})
    expect(() => f.processor.terminate()).toThrow(baseFails ? baseError : unloadError)
    expect(wasm.unloadModel.mock.calls.map(x => x[0])).toEqual([0, 1])
    expect(wasm.destroyInstance.mock.calls.map(x => x[0])).toEqual([0, 1])
    expect(() => f.processor.terminate()).not.toThrow()
    expect(wasm.destroyInstance).toHaveBeenCalledTimes(2)
    base?.mockRestore(); error.mockRestore()
})
it("destroys the retired right instance even when unload fails", async () => {
    const f = fixture("model", false); await ready(f.context)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    wasm.unloadModel.mockImplementationOnce(() => {throw new Error("unload")})
    f.mono(true)
    expect(wasm.destroyInstance).toHaveBeenCalledWith(1)
    f.processor.processAudio(block)
    f.processor.terminate()
    expect(wasm.destroyInstance.mock.calls.map(x => x[0])).toEqual([1, 0])
    error.mockRestore()
})
it("coalesces pending model edits per live device and fences terminated devices", async () => {
    let resolve!: (value: object) => void
    bridge.create.mockImplementationOnce(() => new Promise(r => {resolve = r}))
    const live = fixture("first", false), retired = fixture("first", false)
    for (let i = 0; i < 100; i++) {live.model(`model-${i}`); retired.model(`retired-${i}`)}
    retired.processor.terminate()
    await vi.waitFor(() => expect(bridge.create).toHaveBeenCalledTimes(1))
    resolve({}); await ready(live.context)
    expect(wasm.createInstance).toHaveBeenCalledTimes(2)
    expect(wasm.loadModel.mock.calls.map(x => x[1])).toEqual(["model-99", "model-99"])
    live.model("later")
    expect(wasm.loadModel.mock.calls.map(x => x[1])).toEqual(["model-99", "model-99", "later", "later"])
    live.processor.terminate()
})
it("owns source leases by attachment and silences disconnected subspans", async () => {
    const f = fixture(); await ready(f.context)
    const a = f.processor.setAudioSource(f.input), b = f.processor.setAudioSource(f.input)
    a.terminate(); a.terminate(); f.processor.processAudio(block)
    expect(f.processor.audioOutput.getChannel(0)[0]).toBeCloseTo(0.5)
    b.terminate(); b.terminate()
    f.processor.processAudio({...block, s0: 7, s1: 31})
    f.processor.processAudio({...block, s0: 31, s1: 109})
    for (const ch of f.processor.audioOutput.channels()) {
        expect(ch[6]).toBeCloseTo(0.5); expect(ch[109]).toBeCloseTo(0.5)
        expect(ch.slice(7, 109)).toEqual(new Float32Array(102))
    }
    f.processor.setAudioSource(f.input); f.processor.processAudio(block)
    expect(f.processor.audioOutput.getChannel(0)[37]).toBeCloseTo(0.5)
    f.processor.terminate()
})
it("silences disconnected NAM output after a distinct replacement", async () => {
    const f = fixture(); await ready(f.context)
    const previous = f.processor.setAudioSource(new AudioBuffer())
    const current = f.processor.setAudioSource(f.input)
    previous.terminate(); f.processor.processAudio(block)
    expect(f.processor.audioOutput.getChannel(0)[0]).toBeCloseTo(0.5)
    current.terminate(); f.processor.processAudio(block)
    expect(f.processor.audioOutput.getChannel(0)).toEqual(new Float32Array(128))
    f.processor.terminate()
})
it("retries module initialization failure without duplicating concurrent initialization", async () => {
    bridge.create.mockRejectedValueOnce(new Error("module initialization"))
    const client = {fetchNamWasm: vi.fn().mockResolvedValue(new ArrayBuffer(0))} as unknown as EngineToClient
    expect((await Promise.allSettled([NeuralAmp.fetchWasm(client), NeuralAmp.fetchWasm(client)])).map(x => x.status))
        .toEqual(["rejected", "rejected"])
    await Promise.all([NeuralAmp.fetchWasm(client), NeuralAmp.fetchWasm(client)])
    expect(client.fetchNamWasm).toHaveBeenCalledTimes(2)
    expect(bridge.create).toHaveBeenCalledTimes(2)
    expect(bridge.from).toHaveBeenCalledTimes(1)
})
it("applies a model whose module load failed once another load succeeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    bridge.create.mockRejectedValueOnce(new Error("offline"))
    const f = fixture("", true)
    f.model("model")
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Failed to load NAM WASM:", expect.any(Error)))
    expect(wasm.loadModel).not.toHaveBeenCalled()
    await NeuralAmp.fetchWasm({fetchNamWasm: vi.fn().mockResolvedValue(new ArrayBuffer(0))} as unknown as EngineToClient)
    f.processor.processAudio(block)
    expect(wasm.loadModel.mock.calls.map(x => x[1])).toEqual(["model"])
    expect(wasm.process).toHaveBeenCalled()
    f.processor.processAudio(block)
    expect(wasm.loadModel).toHaveBeenCalledTimes(1)
    f.processor.terminate(); error.mockRestore()
})
