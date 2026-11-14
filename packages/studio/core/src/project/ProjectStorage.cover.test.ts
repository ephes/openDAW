import {afterEach, expect, it, vi} from "vitest"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {UUID} from "@opendaw/lib-std"
import {ProjectStorage} from "./ProjectStorage"
import {Workers} from "../Workers"

vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn()}}}))
afterEach(() => vi.mocked(Workers.Opfs.read).mockReset())

it("reads covers with a budget that admits every accepted cover write", async () => {
    const cover = new Uint8Array(2 * 1024 * 1024)
    vi.mocked(Workers.Opfs.read).mockImplementation(async (_path, maxBytes) => {
        if (cover.byteLength > (maxBytes ?? Infinity)) {throw new RangeError("OPFS read byte limit exceeded")}
        return cover
    })
    const loaded = await ProjectStorage.loadCover(UUID.generate(), {strict: true})
    expect(loaded.unwrap().byteLength).toBe(cover.byteLength)
    expect(vi.mocked(Workers.Opfs.read).mock.calls[0][1]).toBe(OpfsProtocol.ReadLimits.Media)
})
