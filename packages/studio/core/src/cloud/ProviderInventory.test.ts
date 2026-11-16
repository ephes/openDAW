import {afterEach, expect, it, vi} from "vitest"
import {GoogleDriveHandler} from "./GoogleDriveHandler"
import {DropboxHandler} from "./DropboxHandler"

const sdk = vi.hoisted(() => ({list: vi.fn(), next: vi.fn()}))
vi.mock("dropbox", () => ({Dropbox: class {filesListFolder = sdk.list; filesListFolderContinue = sdk.next}}))
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})
for (const provider of ["drive", "dropbox"]) {
    const setup = (pages: {names: string[], token?: string}[]) => {
        let calls = 0
        const next = vi.fn(async () => {
            if (calls >= pages.length) {throw new Error("unexpected extra page")}
            const {names, token} = pages[calls++]
            return provider === "drive" ? Response.json({files: names.map(name => ({name})), nextPageToken: token})
                : {result: {entries: names.map(name => ({name})), cursor: token, has_more: token !== undefined}}
        })
        vi.stubGlobal("fetch", next)
        sdk.list.mockImplementation(next); sdk.next.mockImplementation(next)
        return {handler: provider === "drive" ? new GoogleDriveHandler("synthetic") : new DropboxHandler("synthetic"), next}
    }
    it(`${provider} returns a complete two-page inventory`, async () => {
        const {handler} = setup([{names: ["a"], token: "next"}, {names: ["b"]}])
        await expect(handler.list()).resolves.toEqual(["a", "b"])
    })
    it(`${provider} refuses a repeated continuation before requesting it again`, async () => {
        const {handler, next} = setup([{names: ["a"], token: "same"}, {names: ["b"], token: "same"}])
        await expect(handler.list()).rejects.toThrow("inventory")
        expect(next).toHaveBeenCalledTimes(2)
    })
    it(`${provider} refuses an over-budget last page`, async () => {
        const {handler} = setup([...Array.from({length: 100}, (_, i) => ({names: Array(1000).fill("a"), token: String(i)})), {names: ["overflow"]}])
        await expect(handler.list()).rejects.toThrow("inventory")
    })
    it(`${provider} stops at the page budget`, async () => {
        const {handler, next} = setup(Array.from({length: 1001}, (_, i) => ({names: [], token: String(i)})))
        await expect(handler.list()).rejects.toThrow("inventory")
        expect(next).toHaveBeenCalledTimes(1000)
    })
}
for (const operation of ["upload", "delete"] as const) {
    for (const folder of [false, true]) {
        for (const ids of [["a", "b"], ["b", "a"]]) {
            it(`refuses ambiguous ${folder ? "folder" : "file"} before ${operation} (${ids})`, async () => {
                const fetchMock = vi.fn().mockResolvedValue(Response.json({files: ids.map(id => ({id}))}))
                vi.stubGlobal("fetch", fetchMock)
                const handler = new GoogleDriveHandler("synthetic")
                await expect(operation === "upload" ? handler.upload(folder ? "folder/file" : "file", new ArrayBuffer(0))
                    : handler.delete(folder ? "folder/file" : "file")).rejects.toThrow("Ambiguous")
                expect(fetchMock.mock.calls.every(([, init]) => !init.method)).toBe(true)
            })
        }
    }
}
it("refuses an incomplete unique-name query", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({files: [{id: "one"}], nextPageToken: "more"})))
    await expect(new GoogleDriveHandler("synthetic").delete("file")).rejects.toThrow("Ambiguous")
})
for (const name of ["trailing\\", "a'b", "a\\'b"]) {
    it(`escapes the exact Drive query literal ${name}`, async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({files: []}))
        vi.stubGlobal("fetch", fetchMock)
        await new GoogleDriveHandler("synthetic").exists(`${name}/${name}`)
        const q = new URL(fetchMock.mock.calls[0][0]).searchParams.get("q")!
        expect(q).toContain(`name = '${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`)
    })
}
