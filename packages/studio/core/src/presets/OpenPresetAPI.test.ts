import {afterEach, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {OpenPresetAPI} from "./OpenPresetAPI"
const id = UUID.parse("00000000-0000-4000-8000-000000000001")
const max = 16 * 1024 * 1024
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})
for (const observed of [false, true]) {
    for (const length of [undefined, "1", String(max + 1)]) {
        it(`bounds actual preset bytes (progress=${observed}, length=${length})`, async () => {
            const cancel = vi.fn()
            const body = new ReadableStream({start(c) {c.enqueue(new Uint8Array(max)); c.enqueue(new Uint8Array(1)); c.enqueue(new Uint8Array(1)); c.close()}, cancel})
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {headers: length ? {"Content-Length": length} : {}})))
            await expect(OpenPresetAPI.get().load(id, observed ? () => {} : undefined)).rejects.toThrow(/byte limit/)
            expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false)
        })
    }
    it(`accepts the exact preset limit (progress=${observed})`, async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(max))))
        expect((await OpenPresetAPI.get().load(id, observed ? () => {} : undefined)).byteLength).toBe(max)
    })
}
it("refuses unsupported encoding before consuming bytes", async () => {
    const cancel = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array(1)); c.close()}, cancel}), {headers: {"Content-Encoding": "x-synthetic"}})))
    await expect(OpenPresetAPI.get().load(id)).rejects.toThrow(/encoding/)
    expect(cancel).toHaveBeenCalledOnce()
})
it("rejects abort after a prefix instead of resolving truncated success", async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream({start(c) {c.enqueue(new Uint8Array([1]))}, cancel})
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)))
    await expect(OpenPresetAPI.get().load(id, () => controller.abort(), controller.signal)).rejects.toThrow(/abort/i)
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false)
})
it("settles a throwing observer and releases its reader/listener", async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const cancel = vi.fn()
    const body = new ReadableStream({start(c) {c.enqueue(new Uint8Array([1]))}, cancel})
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)))
    const reason = new Error("synthetic observer")
    const task = OpenPresetAPI.get().load(id, () => {throw reason}, controller.signal)
    let timer: ReturnType<typeof setTimeout>
    try {
        await expect(Promise.race([task, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error("did not settle")), 100)})])).rejects.toBe(reason)
        expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false)
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    } finally {clearTimeout(timer!)}
})
it("settles a source read error and unlocks the stream", async () => {
    const reason = new Error("synthetic source")
    const body = new ReadableStream({start(c) {c.error(reason)}})
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)))
    await expect(OpenPresetAPI.get().load(id, () => {})).rejects.toBe(reason)
    expect(body.locked).toBe(false)
})
it("rejects abort from the EOF progress callback before publishing success", async () => {
    const controller = new AbortController()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(0))))
    await expect(OpenPresetAPI.get().load(id, () => controller.abort(), controller.signal)).rejects.toThrow(/abort/i)
})
