// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {WavFile} from "@opendaw/lib-dsp"
import {OpenSampleAPI} from "./OpenSampleAPI"
import {OpenPresetAPI} from "../presets/OpenPresetAPI"
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})
const tick = async () => {for (let i = 0; i < 100; i++) {await Promise.resolve()}}
it("holds four shared sample/preset permits through bodies and releases error/abort ownership", async () => {
    const id = UUID.parse("00000000-0000-4000-8000-000000000116")
    const sample = {uuid: UUID.toString(id), name: "Synthetic", bpm: 0, duration: 1, sample_rate: 44100, origin: "openDAW"}
    vi.spyOn(WavFile, "decodeFloats").mockReturnValue({numberOfFrames: 1, sampleRate: 44100} as ReturnType<typeof WavFile.decodeFloats>)
    const bodies: {controller: ReadableStreamDefaultController<Uint8Array>, sample: boolean}[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.includes("get.php")) {return Response.json(sample)}
        return new Response(new ReadableStream<Uint8Array>({start(controller) {
            bodies.push({controller, sample: url.includes("/samples/")})
        }}))
    }))
    const controllers = Array.from({length: 8}, () => new AbortController())
    const tasks = controllers.map((controller, i) => i % 2 === 0
        ? OpenPresetAPI.get().load(id, undefined, controller.signal) : OpenSampleAPI.get().load(id, () => {}))
    const settled = Promise.allSettled(tasks)
    try {
        await tick(); expect(bodies).toHaveLength(4)
        bodies.find(body => body.sample)!.controller.error(new Error("synthetic read failure"))
        await tick(); expect(bodies).toHaveLength(5)
        controllers[0].abort()
        await tick(); expect(bodies).toHaveLength(6)
    } finally {
        for (let i = 0; i < 10; i++) {
            for (const {controller} of bodies) {try {controller.enqueue(new Uint8Array([1])); controller.close()} catch { /* already retired */ }}
            await tick()
        }
        await settled
    }
    const outcomes = await settled
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(2)
    expect(bodies).toHaveLength(8)
})
