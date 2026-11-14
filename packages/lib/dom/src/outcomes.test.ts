import {afterEach, describe, expect, it, vi} from "vitest"
import {RuntimeNotifier} from "@opendaw/lib-std"
import {Clipboard} from "./clipboard"
import {Compression} from "./compression"
import {TerminatorUtils} from "./terminable"

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()})

describe("clipboard write outcomes", () => {
    it.each(["reject", "throw", "missing"])("reports %s once and rejects instead of acknowledging", async mode => {
        const failure = new Error("synthetic clipboard refusal")
        const info = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
        vi.stubGlobal("navigator", {clipboard: mode === "missing" ? undefined : {
            writeText: () => {if (mode === "throw") {throw failure}; return Promise.reject(failure)}
        }})
        const result = Clipboard.writeText("https://example.test/join/synthetic")
        if (mode === "missing") {await expect(result).rejects.toBeInstanceOf(TypeError)}
        else {await expect(result).rejects.toBe(failure)}
        expect(info).toHaveBeenCalledTimes(1)
    })
    it("resolves a successful write without an error notice", async () => {
        const info = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
        const writeText = vi.fn().mockResolvedValue(undefined)
        vi.stubGlobal("navigator", {clipboard: {writeText}})
        await expect(Clipboard.writeText("synthetic")).resolves.toBeUndefined()
        expect(writeText).toHaveBeenCalledWith("synthetic")
        expect(info).not.toHaveBeenCalled()
    })
})

describe("compression producer and consumer settlement", () => {
    it("observes malformed and truncated gzip failures and can subsequently round-trip", async () => {
        const input = new TextEncoder().encode("synthetic roundtrip".repeat(100)).buffer
        const encoded = await Compression.encode(input)
        await expect(Compression.decode(new Uint8Array([1, 2, 3]).buffer)).rejects.toBeDefined()
        await expect(Compression.decode(encoded.slice(0, encoded.byteLength - 5))).rejects.toBeDefined()
        expect(await Compression.decode(await Compression.encode(input))).toEqual(input)
        // Vitest treats an unobserved writer/close rejection as a failed run.
        await new Promise(resolve => setTimeout(resolve, 10))
    })
    it("keeps invalid-format failures on the returned promise", async () => {
        await expect(Compression.encode(new ArrayBuffer(0), "invalid" as CompressionFormat)).rejects.toBeDefined()
        await expect(Compression.decode(new ArrayBuffer(0), "invalid" as CompressionFormat)).rejects.toBeDefined()
    })
    it.each(["write", "close"] as const)("cancels the reader and releases locks when %s fails", async step => {
        const error = new Error("synthetic writer failure")
        const cancel = vi.fn()
        const readable = new ReadableStream<Uint8Array>({cancel})
        const writable = new WritableStream<BufferSource>({
            write() {if (step === "write") {throw error}},
            close() {if (step === "close") {throw error}}
        })
        vi.stubGlobal("CompressionStream", class {readable = readable; writable = writable})
        await expect(Compression.encode(new ArrayBuffer(1))).rejects.toBe(error)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(readable.locked).toBe(false)
        expect(writable.locked).toBe(false)
    })
})

describe("weak watcher failure isolation", () => {
    it("retires throwing dead owners once, clears the timer and starts again", () => {
        vi.useFakeTimers()
        vi.stubGlobal("WeakRef", class {deref() {return undefined}})
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        const first = vi.fn()
        const broken = vi.fn(() => {throw new Error("synthetic cleanup failure")})
        TerminatorUtils.watchWeak({}, () => ({terminate: first}))
        TerminatorUtils.watchWeak({}, () => ({terminate: broken}))
        vi.advanceTimersByTime(3000)
        expect(first).toHaveBeenCalledTimes(1)
        expect(broken).toHaveBeenCalledTimes(1)
        expect(warning).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
        const next = vi.fn()
        TerminatorUtils.watchWeak({}, () => ({terminate: next}))
        vi.advanceTimersByTime(1000)
        expect(next).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })
})
