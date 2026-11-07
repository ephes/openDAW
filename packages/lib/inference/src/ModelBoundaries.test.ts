import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {installInferenceConfig} from "./InferenceConfig"
import {ModelStore} from "./ModelStore"
const files = new Map<string, Uint8Array>()
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const path = "inference/models/test/v1/model.onnx"
const descriptor = async () => ({url: "https://synthetic.invalid/model", bytes: 100, version: "v1", sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2, "0")).join("")})
beforeEach(() => {
    files.clear()
    installInferenceConfig({opfs: {
        read: async (path: string) => {const value = files.get(path); if (!value) {throw new Error("missing")} return value},
        write: async (path: string, bytes: Uint8Array) => {files.set(path, bytes)},
        exists: async (path: string) => files.has(path), delete: async () => {}, list: async () => []
    } as OpfsProtocol})
})
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers()})
const tick = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve()}}
for (const corrupt of [new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]), new Uint8Array([1])]) {
    it(`repairs corrupt cached bytes of length ${corrupt.length} under unchanged metadata`, async () => {
        const fetcher = vi.fn(async () => new Response(bytes))
        vi.stubGlobal("fetch", fetcher)
        const model = await descriptor()
        await ModelStore.ensure("test", model)
        files.set(path, corrupt)
        expect(await ModelStore.isCached("test", model)).toBe(true)
        expect(await ModelStore.ensure("test", model)).toEqual(bytes)
        expect(fetcher).toHaveBeenCalledTimes(2)
    })
}
for (const header of [undefined, "1"]) {
    it(`bounds actual streamed bytes with content-length ${header}`, async () => {
        const model = await descriptor()
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const cancel = vi.fn()
        const body = new ReadableStream<Uint8Array>({start(value) {controller = value; value.enqueue(bytes)}, cancel})
        vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {headers: header ? {"Content-Length": header} : {}})))
        let settled = false
        const pending = ModelStore.ensure("test", model, {maxBytes: 4}).then(value => {settled = true; return value}, error => {settled = true; return error})
        try {
            await tick()
            expect(settled).toBe(true)
            expect(await pending).toMatchObject({message: expect.stringContaining("byte limit")})
            expect(cancel).toHaveBeenCalledTimes(1)
            expect(files.size).toBe(0)
        } finally {try {controller.close()} catch { /* Already cancelled. */ }}
    })
}
it("bounds a continually trickling response by whole-transfer time", async () => {
    const model = await descriptor()
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let interval: ReturnType<typeof setInterval>
    const cancel = vi.fn(() => clearInterval(interval))
    const body = new ReadableStream<Uint8Array>({start(value) {controller = value; interval = setInterval(() => value.enqueue(new Uint8Array([1])), 1)}, cancel})
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)))
    let settled = false
    const pending = ModelStore.ensure("test", model, {timeoutMs: 10}).then(value => {settled = true; return value}, error => {settled = true; return error})
    try {
        await tick()
        await vi.advanceTimersByTimeAsync(12)
        expect(settled).toBe(true)
        expect(await pending).toMatchObject({message: expect.stringContaining("timed out")})
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(files.size).toBe(0)
    } finally {clearInterval(interval!); try {controller.close()} catch { /* Already cancelled. */ }}
})
it("composes caller cancellation with transfer ownership and cancels its reader", async () => {
    const model = await descriptor()
    const caller = new AbortController(); const reason = new Error("synthetic caller cancellation")
    const cancel = vi.fn()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({start(value) {stream = value}, cancel}))))
    let settled = false
    const pending = ModelStore.ensure("test", model, {signal: caller.signal}).then(value => {settled = true; return value}, error => {settled = true; return error})
    try {
        await tick(); caller.abort(reason); await tick()
        expect(settled).toBe(true)
        expect(await pending).toBe(reason)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(files.size).toBe(0)
    } finally {try {stream.close()} catch { /* Already cancelled. */ }}
})
it("rejects malformed cache metadata before trusting matching digest text", async () => {
    const model = await descriptor()
    const fetcher = vi.fn(async () => new Response(bytes))
    vi.stubGlobal("fetch", fetcher)
    await ModelStore.ensure("test", model)
    files.set("inference/models/test/v1/meta.json", new TextEncoder().encode(JSON.stringify({sha256: model.sha256})))
    expect(await ModelStore.ensure("test", model)).toEqual(bytes)
    expect(fetcher).toHaveBeenCalledTimes(2)
})

it("allows an installed deadline beyond ten minutes while retaining caller cancellation", async () => {
    const model = await descriptor()
    const config = (await import("./InferenceConfig")).requireInferenceConfig()
    const {Inference} = await import("./Inference")
    Inference.install({...config, modelDownloadTimeoutMs: 20 * 60 * 1000})
    vi.useFakeTimers()
    const caller = new AbortController(); const reason = new Error("synthetic cancelled slow link")
    const cancel = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({cancel}))))
    let settled = false
    const pending = ModelStore.ensure("test", model, {signal: caller.signal}).then(value => {settled = true; return value}, error => {settled = true; return error})
    try {
        await tick(); await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
        expect(settled).toBe(true)
        expect(await pending).toMatchObject({message: expect.stringContaining("timed out")})
    } finally {caller.abort(reason); await tick(); await pending; await Inference.shutdown()}
    expect(cancel).toHaveBeenCalledTimes(1)
})
it("keeps useful HTTP source context without credentials or query values", async () => {
    const model = {...await descriptor(), url: "https://user:synthetic-password@synthetic.invalid/model.onnx?key=synthetic-private-query#fragment"}
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status: 503, statusText: "Unavailable"})))
    await expect(ModelStore.ensure("test", model)).rejects.toMatchObject({message: "Model fetch failed: 503 Unavailable (https://synthetic.invalid/model.onnx)"})
})
