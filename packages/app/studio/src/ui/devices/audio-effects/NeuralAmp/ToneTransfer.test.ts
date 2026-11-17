import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {downloadModel, fetchTone} from "./NamTone3000"

vi.mock("@opendaw/studio-core", () => ({Workers: {Opfs: {}}}))
vi.mock("./Tone3000Dialog", () => ({showTone3000Dialog: async () => {}}))
const url = "https://example.test/tone"
const validModel = {version: "0.5.4", architecture: "WaveNet", config: {}, weights: [1, 2]}
const validTone = {id: 1, title: "Synthetic", updated_at: "v1", models: [{id: 1, name: "Test", size: "standard", model_url: url}]}
beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn())})
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})
it.each(["metadata", "model"])("refuses declared %s overflow before buffering", async kind => {
    const cancel = vi.fn()
    const body = new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(JSON.stringify(kind === "metadata" ? validTone : validModel)))}, cancel})
    vi.mocked(fetch).mockResolvedValue(new Response(body, {headers: {"Content-Length": "1000000000"}}))
    await expect(kind === "metadata" ? fetchTone(url) : downloadModel(url)).rejects.toBeDefined()
    expect(cancel).toHaveBeenCalledOnce()
})
it.each(["metadata", "model"])("counts actual chunked %s bytes despite a lying length", async kind => {
    const limit = kind === "metadata" ? 1024 * 1024 : 16 * 1024 * 1024
    const payload = JSON.stringify(kind === "metadata" ? {...validTone, padding: "x".repeat(limit)} : {...validModel, padding: "x".repeat(limit)})
    const bytes = new TextEncoder().encode(payload)
    const cancel = vi.fn()
    let offset = 0
    const body = new ReadableStream<Uint8Array>({pull(controller) {
        if (offset >= bytes.length) {controller.close(); return}
        controller.enqueue(bytes.subarray(offset, offset + 65536)); offset += 65536
    }, cancel})
    vi.mocked(fetch).mockResolvedValue(new Response(body, {headers: {"Content-Length": "1"}}))
    await expect(kind === "metadata" ? fetchTone(url) : downloadModel(url)).rejects.toBeDefined()
})
it.each(["headers", "body", "cancel"])("bounds stalled metadata %s and releases its reader", async phase => {
    const cancel = vi.fn()
    vi.mocked(fetch).mockImplementation(() => phase === "headers" ? new Promise(() => {})
        : Promise.resolve(new Response(new ReadableStream({cancel}))))
    const controller = new AbortController()
    let settled = false
    const result = fetchTone(url, controller.signal).then(() => "success", () => {settled = true; return "failure"})
    await vi.advanceTimersByTimeAsync(0)
    if (phase === "cancel") {controller.abort()}
    await vi.advanceTimersByTimeAsync(15_000)
    expect(settled).toBe(true)
    expect(await result).toBe("failure")
    if (phase !== "headers") {expect(cancel).toHaveBeenCalledOnce()}
    expect(vi.getTimerCount()).toBe(0)
})
it.each(["deadline", "cancel"])("composes model transfer with %s", async kind => {
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({})))
    let settled = false
    const controller = new AbortController()
    const result = downloadModel(url, controller.signal).then(() => "success", () => {settled = true; return "failure"})
    await vi.advanceTimersByTimeAsync(0)
    if (kind === "cancel") {controller.abort()}
    await vi.advanceTimersByTimeAsync(60_000)
    expect(settled).toBe(true)
    expect(await result).toBe("failure")
    expect(vi.getTimerCount()).toBe(0)
})
it.each([null, {}, {...validTone, id: -1}, {...validTone, models: []}, {...validTone, models: [validTone.models[0], validTone.models[0]]}, {...validTone, models: [{...validTone.models[0], model_url: "javascript:bad"}]}])("admits the complete metadata shape", async value => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(value)))
    await expect(fetchTone(url)).rejects.toBeDefined()
})
it.each(["truncated", "null", "{}", JSON.stringify({...validModel, weights: ["bad"]})])("refuses malformed NAM bytes %s", async text => {
    vi.mocked(fetch).mockResolvedValue(new Response(text))
    await expect(downloadModel(url)).rejects.toBeDefined()
})
it("admits complete synthetic provider responses and releases its deadline", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(validTone))).mockResolvedValueOnce(new Response(JSON.stringify(validModel)))
    expect(await fetchTone(url)).toEqual(validTone)
    expect(JSON.parse(await downloadModel(url))).toEqual(validModel)
    expect(vi.getTimerCount()).toBe(0)
})

it("does not reset the total metadata deadline on trickling bytes", async () => {
    let interval: ReturnType<typeof setInterval>
    const cancel = vi.fn(() => clearInterval(interval))
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({
        start(controller) {interval = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), 1000)}, cancel
    })))
    let settled = false
    const pending = fetchTone(url).catch(() => {settled = true})
    await vi.advanceTimersByTimeAsync(15_000)
    expect(settled).toBe(true)
    await pending
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
})
it("refuses an already cancelled caller before opening a transfer", async () => {
    const controller = new AbortController(); controller.abort()
    await expect(fetchTone(url, controller.signal)).rejects.toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
})
