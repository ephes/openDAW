import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {VideoOverlay} from "./VideoOverlay"
const config = {width: 1280, height: 720, projectName: "Synthetic", toParts: () => ({bars: 0, beats: 0, semiquavers: 0, ticks: 0})}
beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("OffscreenCanvas", class {getContext() {return {}}})
})
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals()})
for (const stage of ["fetch", "blob", "decode"] as const) {
    it(`bounds an enabled overlay's pending ${stage} and closes a late bitmap`, async () => {
        const pending = Promise.withResolvers<never>()
        const close = vi.fn()
        vi.stubGlobal("fetch", vi.fn(() => stage === "fetch" ? pending.promise : Promise.resolve({ok: true, blob: () => stage === "blob" ? pending.promise : Promise.resolve(new Blob())})))
        vi.stubGlobal("createImageBitmap", vi.fn(() => stage === "decode" ? pending.promise : Promise.resolve({close})))
        let rejected = false
        const create = VideoOverlay.create(config)
        void create.catch(() => {rejected = true})
        await vi.advanceTimersByTimeAsync(10001)
        expect(rejected).toBe(true)
        await expect(create).rejects.toThrow(/overlay|timed/i)
        pending.reject(new Error("late asset failure"))
        await Promise.resolve()
    })
}
it("closes a decoded bitmap that arrives after the overlay deadline", async () => {
    const decoded = Promise.withResolvers<ImageBitmap>()
    vi.stubGlobal("fetch", vi.fn(async () => ({ok: true, blob: async () => new Blob()})))
    vi.stubGlobal("createImageBitmap", vi.fn(() => decoded.promise))
    const create = VideoOverlay.create(config)
    const result = expect(create).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10001)
    const close = vi.fn()
    decoded.resolve({close} as unknown as ImageBitmap)
    await result
    for (let i = 0; i < 10; i++) {await Promise.resolve()}
    expect(close).toHaveBeenCalledTimes(1)
})
it("reports an HTTP asset refusal instead of trying to decode it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ok: false, blob: async () => new Blob()})))
    const decode = vi.fn(async () => ({}))
    vi.stubGlobal("createImageBitmap", decode)
    await expect(VideoOverlay.create(config)).rejects.toThrow()
    expect(decode).not.toHaveBeenCalled()
})
it("observes parent cancellation while loading the enabled asset", async () => {
    const controller = new AbortController()
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal("fetch", fetch)
    const create = VideoOverlay.create(config, controller.signal)
    controller.abort(new Error("parent cancelled"))
    await expect(create).rejects.toThrow("parent cancelled")
    expect(fetch.mock.calls[0]).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
})
