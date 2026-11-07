import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {RingBuffer} from "@opendaw/studio-adapters"
import {RecordingWorklet} from "./RecordingWorklet"
import {SampleService} from "./samples"

vi.hoisted(() => {vi.stubGlobal("AudioWorkletNode", class {
    readonly channelCount: number
    constructor(readonly context: BaseAudioContext, _name: string, options: AudioWorkletNodeOptions) {this.channelCount = options.channelCount!}
})})
let append: (frames: Float32Array[]) => void
let stop: ReturnType<typeof vi.fn>
const uuid = "00000000-0000-4000-8000-000000000001"
beforeEach(() => {
    stop = vi.fn()
    vi.spyOn(RingBuffer, "reader").mockImplementation((_config, callback) => {append = callback; return {stop}})
})
afterEach(() => vi.restoreAllMocks())
const create = () => {
    const worklet = new RecordingWorklet({sampleRate: 44100} as BaseAudioContext, {numberOfChannels: 1} as RingBuffer.Config)
    append([new Float32Array(128).fill(0.25)])
    return worklet
}
it("claims finalization once before deferred import and publishes once", async () => {
    const worklet = create()
    let done!: (value: {uuid: string}) => void
    const importRecording = vi.fn(() => new Promise(resolve => {done = resolve}))
    worklet.sampleService = {importRecording} as unknown as SampleService
    const saved = vi.fn()
    const owned = {terminate: vi.fn()}
    worklet.onSaved = saved
    worklet.own(owned)
    worklet.limit(128); worklet.limit(128)
    expect(importRecording).toHaveBeenCalledTimes(1)
    done({uuid})
    await vi.waitFor(() => expect(worklet.state.type).toBe("loaded"))
    worklet.limit(128)
    expect(importRecording).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledTimes(1)
    expect(owned.terminate).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
})
it("import failure publishes terminal error, retains audio, and cleans owned resources", async () => {
    const worklet = create()
    worklet.sampleService = {importRecording: vi.fn().mockRejectedValue(new Error("private synthetic storage detail"))} as unknown as SampleService
    const saved = vi.fn()
    const observer = vi.fn()
    const owned = {terminate: vi.fn()}
    worklet.onSaved = saved
    worklet.own(owned)
    worklet.subscribe(observer)
    worklet.limit(128)
    await vi.waitFor(() => expect(worklet.state.type).toBe("error"))
    expect(JSON.stringify(worklet.state)).not.toContain("private synthetic")
    expect(worklet.data.unwrap().frames[0][0]).toBe(0.25)
    expect(saved).not.toHaveBeenCalled()
    expect(owned.terminate).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    worklet.subscribe(late)
    expect(late).toHaveBeenCalledWith(worklet.state)
})

for (const failure of ["saved callback", "loaded subscriber"]) {
    it(`keeps successful persistence loaded after a throwing ${failure}`, async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const worklet = create()
        worklet.sampleService = {importRecording: vi.fn().mockResolvedValue({uuid})} as unknown as SampleService
        const owned = {terminate: vi.fn()}
        worklet.own(owned)
        if (failure === "saved callback") {worklet.onSaved = () => {throw new Error("callback")}}
        else {worklet.subscribe(() => {throw new Error("observer")})}
        worklet.limit(128)
        await vi.waitFor(() => expect(owned.terminate).toHaveBeenCalledTimes(1))
        expect(worklet.state.type).toBe("loaded")
        const late = vi.fn()
        worklet.subscribe(late)
        expect(late).toHaveBeenCalledWith({type: "loaded"})
    })
}
