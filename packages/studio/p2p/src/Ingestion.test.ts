import {afterEach, expect, it, vi} from "vitest"
import JSZip from "jszip"
import {UUID} from "@opendaw/lib-std"
import * as Protocol from "./ChunkProtocol"
import {PeerAssetProvider} from "./PeerAssetProvider"
import {AssetSignaling} from "./AssetSignaling"
import {AssetZip} from "./AssetZip"
const fake = vi.hoisted(() => ({channels: [] as Array<Record<string, (event: {data: ArrayBuffer}) => void>>, terminate: vi.fn()}))
vi.mock("./AssetPeerConnection", () => ({AssetPeerConnection: class {
    async createOffer() {const channel = {send: vi.fn()}; fake.channels.push(channel); return channel}
    terminate = fake.terminate
}}))
afterEach(() => {vi.restoreAllMocks(); fake.channels.length = 0; fake.terminate.mockClear()})
const id = UUID.parse("00000000-0000-4000-8000-000000000001")
for (let length = 0; length < Protocol.HEADER_SIZE; length++) {
    it(`rejects short frame ${length}`, () => expect(() => Protocol.decode(new ArrayBuffer(length))).toThrow())
}
it("rejects unknown types and nonbinary frames", () => {
    expect(() => Protocol.decode(Protocol.encode(99 as Protocol.MsgType, id, 0, new Uint8Array()))).toThrow()
    expect(() => Protocol.decode("not binary" as unknown as ArrayBuffer)).toThrow()
})
const setup = async () => {
    let listener!: (message: Record<string, unknown>) => void
    const signaling = {subscribe: vi.fn((fn: (message: Record<string, unknown>) => void) => {listener = fn; return {terminate: vi.fn()}}), publish: vi.fn()}
    const provider = new PeerAssetProvider(signaling as unknown as AssetSignaling, "local")
    const progress = vi.fn()
    const pending = provider.fetchSample(id, progress)
    const outcome = pending.catch(error => error)
    listener({type: "asset-inventory", peerId: "peer", targetPeerId: "local", have: [UUID.toString(id)]})
    await Promise.resolve(); await Promise.resolve()
    const channel = fake.channels.at(-1)!
    const send = (type: number, payload = new Uint8Array(), index = 0, asset = id) => fake.channels.at(-1)!.onmessage({data: Protocol.encode(type, asset, index, payload)})
    return {provider, outcome, progress, send, channel, listener}
}
const exhaust = async (fixture: Awaited<ReturnType<typeof setup>>, action: () => void) => {
    let settled = false
    void fixture.outcome.then(() => {settled = true})
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            fixture.listener({type: "asset-inventory", peerId: "peer", targetPeerId: "local", have: [UUID.toString(id)]})
            for (let i = 0; i < 8; i++) {await Promise.resolve()}
        }
        expect(fake.channels).toHaveLength(attempt + 1)
        action()
        for (let i = 0; i < 8; i++) {await Promise.resolve()}
        expect(settled).toBe(attempt === 2)
    }
    await expect(fixture.outcome).resolves.toMatchObject({message: expect.stringContaining("after 3 retries")})
}
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
for (const meta of [{totalChunks: Infinity, zipSize: 1}, {totalChunks: 1.5, zipSize: 1}, {totalChunks: 999999999, zipSize: 1}, {totalChunks: 1}, {totalChunks: 1, zipSize: 999999999999}]) {
    it(`rejects invalid transfer metadata ${JSON.stringify(meta)}`, async () => {
        const f = await setup()
        await exhaust(f, () => {expect(() => f.send(Protocol.MsgType.TransferStart, json(meta))).not.toThrow()})
        let settled = false
        void f.outcome.then(() => {settled = true})
        for (let i = 0; i < 8; i++) {await Promise.resolve()}
        expect(settled).toBe(true)
        expect(fake.terminate).toHaveBeenCalled()
        f.provider.terminate()
    })
}
for (const fault of ["identity", "json", "index", "overflow", "restart", "missing"]) {
    it(`fails controlled transfer on ${fault}`, async () => {
        const f = await setup()
        await exhaust(f, () => {
        f.send(Protocol.MsgType.TransferStart, json({totalChunks: 1, zipSize: 2}))
        if (fault === "identity") {f.send(Protocol.MsgType.ChunkData, new Uint8Array([1]), 0, UUID.generate())}
        if (fault === "json") {f.send(Protocol.MsgType.TransferStart, json("junk"))}
        if (fault === "index") {f.send(Protocol.MsgType.ChunkData, new Uint8Array([1]), 5)}
        if (fault === "overflow") {f.send(Protocol.MsgType.ChunkData, new Uint8Array([1, 2, 3]))}
        if (fault === "restart") {f.send(Protocol.MsgType.TransferStart, json({totalChunks: 1, zipSize: 2}))}
        if (fault === "missing") {f.send(Protocol.MsgType.TransferComplete)}
        })
        // A microtask oracle catches unsettled promises without platform timeouts.
        let settled = false
        void f.outcome.then(() => {settled = true})
        for (let i = 0; i < 8; i++) {await Promise.resolve()}
        expect(settled).toBe(true)
        expect(fake.terminate).toHaveBeenCalled()
        f.provider.terminate()
    })
}
it("bounds actual ZIP inflation and entry count with synthetic compressed data", async () => {
    const zip = new JSZip().file("soundfont.sf2", new Uint8Array(100_000)).file("meta.json", "{}")
    const bytes = await zip.generateAsync({type: "arraybuffer", compression: "DEFLATE"})
    await expect(AssetZip.unpackSoundfont(bytes, {entries: 2, metadata: 10, media: 100, total: 110})).rejects.toThrow(/limit/)
    await expect(AssetZip.unpackSoundfont(bytes, {entries: 1, metadata: 10, media: 100_000, total: 100_010})).rejects.toThrow(/limit/)
})

it("accepts a complete contiguous wire transfer and releases the connection", async () => {
    const result = [] as unknown as Awaited<ReturnType<typeof AssetZip.unpackSample>>
    vi.spyOn(AssetZip, "unpackSample").mockResolvedValue(result)
    const f = await setup()
    f.send(Protocol.MsgType.TransferStart, json({totalChunks: 1, zipSize: 2}))
    f.send(Protocol.MsgType.ChunkData, new Uint8Array([1, 2]))
    f.send(Protocol.MsgType.TransferComplete)
    await expect(f.outcome).resolves.toBe(result)
    expect(fake.terminate).toHaveBeenCalledTimes(1)
    f.provider.terminate()
})
it("roundtrips a normal soundfont archive under bounded extraction", async () => {
    const meta = {name: "Synthetic", size: 2, url: "", license: "", origin: "import" as const}
    const bytes = await AssetZip.packSoundfont(new Uint8Array([1, 2]).buffer, meta)
    const [data, decoded] = await AssetZip.unpackSoundfont(bytes)
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2]))
    expect(decoded).toEqual(meta)
})

it("retries a bad peer then accepts a good peer, ignoring stale frames", async () => {
    const result = [] as unknown as Awaited<ReturnType<typeof AssetZip.unpackSample>>
    vi.spyOn(AssetZip, "unpackSample").mockResolvedValue(result)
    const f = await setup()
    const stale = f.channel.onmessage
    f.send(Protocol.MsgType.TransferStart, json({totalChunks: 0, zipSize: 0}))
    f.listener({type: "asset-inventory", peerId: "good-peer", targetPeerId: "local", have: [UUID.toString(id)]})
    for (let i = 0; i < 8; i++) {await Promise.resolve()}
    stale({data: new ArrayBuffer(0)})
    f.send(Protocol.MsgType.TransferStart, json({totalChunks: 1, zipSize: 2}))
    f.send(Protocol.MsgType.ChunkData, new Uint8Array([1, 2]))
    f.send(Protocol.MsgType.TransferComplete)
    await expect(f.outcome).resolves.toBe(result)
    f.provider.terminate()
})
