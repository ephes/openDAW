import {afterEach, expect, it, vi} from "vitest"
import {GoogleDriveHandler} from "./GoogleDriveHandler"
import {DropboxHandler} from "./DropboxHandler"

// Keep these at the network boundary, including Dropbox's real public SDK fetch hook.
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})
const driveResponse = (response: Response) => vi.fn(async (url: string) => url.includes("alt=media") ? response : Response.json({files: [{id: "file"}]}))
for (const declared of [undefined, "1", "16777217"]) {
    it(`bounds Drive preset bytes with length ${declared}`, async () => {
        const cancel = vi.fn()
        const stream = new ReadableStream({start(c) {c.enqueue(new Uint8Array(16 * 1024 * 1024)); c.enqueue(new Uint8Array(1))}, cancel})
        vi.stubGlobal("fetch", driveResponse(new Response(stream, {headers: declared ? {"Content-Length": declared} : {}})))
        await expect(new GoogleDriveHandler("synthetic").download("presets/file.odp")).rejects.toThrow(/byte limit/)
        expect(cancel).toHaveBeenCalledOnce()
        expect(stream.locked).toBe(false)
    })
}
it("accepts exact-limit Drive bytes", async () => {
    vi.stubGlobal("fetch", driveResponse(new Response(new Uint8Array(16 * 1024 * 1024))))
    expect((await new GoogleDriveHandler("synthetic").download("presets/file.odp")).byteLength).toBe(16 * 1024 * 1024)
})
it("bounds Dropbox bytes before the SDK materializes a Blob", async () => {
    const cancel = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array(1))}, cancel}),
        {headers: {"Content-Length": "16777217", "Dropbox-API-Result": "{}"}})))
    await expect(new DropboxHandler("synthetic").download("presets/file.odp")).rejects.toThrow(/byte limit/)
    expect(cancel).toHaveBeenCalledOnce()
})
for (const stage of ["lookup", "body", "continuation"]) {
    it(`settles a stalled Drive ${stage} at the whole-operation deadline`, async () => {
        vi.useFakeTimers()
        const never = new Promise<Response>(() => {})
        const fetchMock = stage === "lookup" ? vi.fn(() => never) : stage === "body"
            ? driveResponse(new Response(new ReadableStream({pull() {return new Promise(() => {})}})))
            : vi.fn().mockResolvedValueOnce(Response.json({files: [], nextPageToken: "next"})).mockImplementation(() => never)
        vi.stubGlobal("fetch", fetchMock)
        const handler = new GoogleDriveHandler("synthetic")
        const result = expect(stage === "continuation" ? handler.list() : handler.download("file")).rejects.toThrow(/deadline/)
        await vi.advanceTimersByTimeAsync(600000)
        await result
    })
}
for (const Handler of [GoogleDriveHandler, DropboxHandler]) {
    it(`${Handler.name} observes caller cancellation for inventory`, async () => {
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
        const controller = new AbortController()
        const task = new Handler("synthetic").list(undefined, controller.signal)
        const result = expect(task).rejects.toThrow(/abort/i)
        controller.abort()
        await result
    })
    it(`${Handler.name} never exposes remote error bodies`, async () => {
        const cancel = vi.fn()
        const response = new Response(new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode("sentinel-account-token".repeat(100000)))}, cancel}), {status: 401})
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
        const error = await new Handler("synthetic").alive().catch(error => error)
        expect(error.message).toMatch(/401/)
        expect(String(error)).not.toContain("sentinel")
        expect(String(error).length).toBeLessThan(200)
        expect(cancel).toHaveBeenCalled()
    })
}
it("releases Drive folder lookup ownership on timeout and discards late headers", async () => {
    vi.useFakeTimers()
    const late = Promise.withResolvers<Response>()
    const fetchMock = vi.fn().mockImplementationOnce(() => late.promise)
        .mockResolvedValue(Response.json({files: [{id: "unique"}]}))
    vi.stubGlobal("fetch", fetchMock)
    const handler = new GoogleDriveHandler("synthetic")
    const first = expect(handler.upload("folder/file", new ArrayBuffer(0))).rejects.toThrow("deadline")
    await vi.advanceTimersByTimeAsync(600000)
    await first
    // A new lookup must start rather than failing the folder-in-progress guard.
    const controller = new AbortController()
    const next = handler.upload("folder/file", new ArrayBuffer(0), controller.signal)
    const result = expect(next).rejects.toThrow(/abort/i)
    controller.abort(); await result
    const cancel = vi.fn()
    late.resolve(new Response(new ReadableStream({cancel})))
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.every(([, init]) => !init.method)).toBe(true)
})
