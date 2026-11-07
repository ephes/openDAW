import {expect, it, vi} from "vitest"
import {SoundFont2} from "soundfont2"
import {UUID} from "@opendaw/lib-std"
import {SoundfontStorage} from "./SoundfontStorage"
import {Workers} from "../Workers"
vi.mock("../Workers", () => ({Workers: {Opfs: {read: vi.fn()}}}))
it("loads exactly an OPFS view and parses a synthetic valid SF2 without neighboring bytes", async () => {
    // Generated empty RIFF/sfbk, 408 bytes; all metadata and terminal records synthetic.
    const bytes = Uint8Array.from(atob("UklGRpABAABzZmJrTElTVDIAAABJTkZPaWZpbAQAAAACAAEAaXNuZwgAAABFTVU4MDAwAElOQU0KAAAAU3ludGhldGljAExJU1RoAAAAc2R0YXNtcGxcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMSVNU2gAAAHBkdGFwaGRyJgAAAEVPUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcGJhZwQAAAAAAAAAcG1vZAoAAAAAAAAAAAAAAAAAcGdlbgQAAAAAAAAAaW5zdBYAAABFT0kAAAAAAAAAAAAAAAAAAAAAAAAAaWJhZwQAAAAAAAAAaW1vZAoAAAAAAAAAAAAAAAAAaWdlbgQAAAAAAAAAc2hkci4AAABFT1MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), char => char.charCodeAt(0))
    expect(new SoundFont2(bytes).metaData.name).toBe("Synthetic")
    const backing = new Uint8Array(bytes.length + 4).fill(91); backing.set(bytes, 2)
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => path.endsWith("soundfont.sf2")
        ? backing.subarray(2, bytes.length + 2)
        : new TextEncoder().encode(JSON.stringify({name: "Synthetic", size: bytes.length, origin: "import", license: "synthetic", url: ""})))
    const [file] = await SoundfontStorage.get().load(UUID.parse("00000000-0000-4000-8000-000000000001"))
    expect(file.byteLength).toBe(bytes.length)
    expect(new Uint8Array(file)).toEqual(bytes)
    expect(new SoundFont2(new Uint8Array(file)).metaData.name).toBe("Synthetic")
})
