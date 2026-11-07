import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {webcrypto} from "node:crypto"
import {ByteArrayInput, ByteArrayOutput, Hash} from "@opendaw/lib-std"
import {Commit} from "./Commit"
import {SyncLogReader} from "./SyncLogReader"
import {Project} from "../project/Project"
import type {ProjectEnv} from "../project/ProjectEnv"
vi.mock("../project/Project", () => ({Project: {load: vi.fn()}}))
const graph = {beginTransaction: vi.fn(), endTransaction: vi.fn()}
const env = {} as ProjectEnv
const project = (value = 1) => ({toArrayBuffer: () => new Uint8Array([value]).buffer} as unknown as Project)
const concat = (...buffers: ArrayBuffer[]) => {
    const bytes = new Uint8Array(buffers.reduce((n, x) => n + x.byteLength, 0))
    let offset = 0
    for (const buffer of buffers) {bytes.set(new Uint8Array(buffer), offset); offset += buffer.byteLength}
    return bytes.buffer
}
beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto)
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    vi.mocked(Project.load).mockReturnValue({boxGraph: graph} as unknown as Project)
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})
it("binds different payloads to different hashes at the same time and previous hash", async () => {
    const a = await Commit.createFirst(project(1)), b = await Commit.createFirst(project(2))
    expect(Hash.equals(a.thisHash, b.thisHash)).toBe(false)
})
for (const [field, offset] of [["type", 3], ["payload", 76], ["hash", 40], ["previous hash", 8], ["date", 80]] as const) {
    it(`rejects tampered ${field} before project/graph mutation`, async () => {
        const first = await Commit.createFirst(project())
        const update = await Commit.createUpdate(first.thisHash, [])
        const bytes = new Uint8Array(update.serialize())
        bytes[offset] ^= 1
        await expect(SyncLogReader.unwrap(env, concat(first.serialize(), bytes.buffer))).rejects.toThrow()
        expect(Project.load).not.toHaveBeenCalled()
        expect(graph.beginTransaction).not.toHaveBeenCalled()
    })
}
it("accepts exact record-boundary EOF and refuses every truncated next field", async () => {
    const first = await Commit.createFirst(project())
    const next = await Commit.createOpen(first.thisHash)
    const bytes = next.serialize()
    expect((await SyncLogReader.unwrap(env, first.serialize())).numCommits).toBe(1)
    for (let i = 1; i < bytes.byteLength; i++) {
        await expect(SyncLogReader.unwrap(env, concat(first.serialize(), bytes.slice(0, i)))).rejects.toThrow(/Truncated|payload length/)
    }
    expect((await SyncLogReader.unwrap(env, concat(first.serialize(), bytes))).numCommits).toBe(2)
})
for (const length of [-1, 2147483647]) {
    it(`rejects payload length ${length} before allocation`, async () => {
        const bytes = (await Commit.createFirst(project())).serialize()
        new DataView(bytes).setInt32(72, length)
        const Native = Int8Array
        let oversized = false
        vi.stubGlobal("Int8Array", new Proxy(Native, {construct(target, args) {
            if (typeof args[0] === "number" && args[0] > 1024) {oversized = true; throw new Error("oversized allocation")}
            return Reflect.construct(target, args)
        }}))
        expect(() => Commit.deserialize(new ByteArrayInput(bytes))).toThrow(/payload length/)
        expect(oversized).toBe(false)
    })
}
it("rejects legacy logs by default and allows explicit unauthenticated legacy reads", async () => {
    const out = ByteArrayOutput.create()
    out.writeInt(0); out.writeInt(1)
    out.writeBytes(new Int8Array(32)); out.writeBytes(new Int8Array(32))
    out.writeInt(1); out.writeByte(1); out.writeDouble(1700000000000)
    const bytes = out.toArrayBuffer() as ArrayBuffer
    await expect(SyncLogReader.unwrap(env, bytes)).rejects.toThrow(/Legacy/)
    const readLegacy = SyncLogReader.unwrap as (env: ProjectEnv, bytes: ArrayBuffer, options: {allowLegacy: boolean}) => ReturnType<typeof SyncLogReader.unwrap>
    expect((await readLegacy(env, bytes, {allowLegacy: true})).numCommits).toBe(1)
})
