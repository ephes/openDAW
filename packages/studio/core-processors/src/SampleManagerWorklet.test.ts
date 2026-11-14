import {expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {EngineToClient} from "@opendaw/studio-adapters"
import {SampleManagerWorklet} from "./SampleManagerWorklet"

const uuid = UUID.parse("00000000-0000-4000-8000-000000000001")
const audio: AudioData = {sampleRate: 44100, numberOfChannels: 1, numberOfFrames: 1, frames: [new Float32Array(new SharedArrayBuffer(4)).fill(1)]}
const deferred = () => {
    let resolve = (_value: AudioData): void => {}
    let reject = (_reason: Error): void => {}
    const promise = new Promise<AudioData>((success, failure) => {resolve = success; reject = failure})
    return {promise, resolve, reject}
}
const flush = async () => {for (let index = 0; index < 10; index++) {await Promise.resolve()}}

for (const retirement of ["remove", "terminate"] as const) {
    it(`ignores fetch success after ${retirement}`, async () => {
        const request = deferred()
        const manager = new SampleManagerWorklet({fetchAudio: () => request.promise} as unknown as EngineToClient)
        const loader = manager.getOrCreate(uuid)
        if (retirement === "remove") {manager.remove(uuid); manager.remove(uuid)} else {manager.terminate()}
        request.resolve(audio); await flush()
        expect(loader.data.isEmpty()).toBe(true)
        expect(loader.state.type).not.toBe("loaded")
    })
}

it("ignores a retired rejection without notifying or resurrecting data", async () => {
    const request = deferred()
    const manager = new SampleManagerWorklet({fetchAudio: () => request.promise} as unknown as EngineToClient)
    const loader = manager.getOrCreate(uuid)
    const notify = vi.fn()
    loader.subscribe(notify); notify.mockClear()
    manager.terminate(); notify.mockClear()
    request.reject(new Error("retired")); await flush()
    expect(notify).not.toHaveBeenCalled()
    expect(loader.data.isEmpty()).toBe(true)
})

it("keeps the latest invalidation when requests resolve out of order", async () => {
    const old = deferred()
    const current = deferred()
    const fetchAudio = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const manager = new SampleManagerWorklet({fetchAudio} as unknown as EngineToClient)
    const loader = manager.getOrCreate(uuid)
    manager.invalidate(uuid)
    current.resolve(audio); await flush()
    old.resolve({...audio, frames: [new Float32Array(new SharedArrayBuffer(4)).fill(2)]}); await flush()
    expect(loader.data.unwrap()).toBe(audio)
    manager.terminate()
    expect(() => manager.getOrCreate(uuid)).toThrow("terminated")
})
