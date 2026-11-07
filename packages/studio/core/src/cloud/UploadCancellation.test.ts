import {afterEach, expect, it, vi} from "vitest"
import {DropboxHandler} from "./DropboxHandler"
import {GoogleDriveHandler} from "./GoogleDriveHandler"

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})
it("passes cancellation through the Dropbox SDK's public fetch option", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({path_display: "/synthetic"}))
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    await new DropboxHandler("synthetic").upload("synthetic", new ArrayBuffer(1), controller.signal)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
})
it("passes cancellation through Drive lookups and the final upload", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({files: []}))
        .mockResolvedValueOnce(Response.json({id: "folder-id"}))
        .mockResolvedValueOnce(Response.json({files: []})).mockResolvedValueOnce(new Response())
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    await new GoogleDriveHandler("synthetic").upload("folder/synthetic", new ArrayBuffer(1), controller.signal)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.every(([, init]) => init.signal === controller.signal)).toBe(true)
})
for (const Handler of [DropboxHandler, GoogleDriveHandler]) {
    it(`${Handler.name} does not start a pre-aborted upload`, async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const controller = new AbortController(); controller.abort()
        await expect(new Handler("synthetic").upload("synthetic", new ArrayBuffer(1), controller.signal)).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
    })
}
