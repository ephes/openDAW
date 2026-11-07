import {describe, expect, it, vi} from "vitest"
import {network} from "./network"

const responseFor = (body: ReadableStream<Uint8Array>) => new Response(body, {
    status: 206, statusText: "Partial Content", headers: {"Content-Length": "32", "X-Test": "synthetic"}
})

describe("progress response", () => {
    it("does not drain a source without demand and forwards cancellation", async () => {
        let pulls = 0
        const cancel = vi.fn()
        const source = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pulls === 32) {controller.close()} else {controller.enqueue(new Uint8Array([pulls++]))}
            }, cancel
        })
        const progress = vi.fn()
        const wrapped = network.progress(progress)(responseFor(source))
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(pulls).toBeLessThanOrEqual(2)
        const reader = wrapped.body!.getReader()
        expect((await reader.read()).value).toEqual(new Uint8Array([0]))
        await reader.cancel("finished")
        expect(cancel).toHaveBeenCalledWith("finished")
        const reported = progress.mock.calls.length
        await Promise.resolve()
        expect(progress).toHaveBeenCalledTimes(reported)
        expect(source.locked).toBe(false)
    })
    it("preserves bytes, progress and response metadata through EOF", async () => {
        const source = new ReadableStream<Uint8Array>({start(controller) {
            controller.enqueue(new Uint8Array([1, 2]))
            controller.enqueue(new Uint8Array([3, 4]))
            controller.close()
        }})
        const progress = vi.fn()
        const wrapped = network.progress(progress)(responseFor(source))
        expect(wrapped.status).toBe(206)
        expect(wrapped.statusText).toBe("Partial Content")
        expect(wrapped.headers.get("X-Test")).toBe("synthetic")
        expect(new Uint8Array(await wrapped.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
        expect(progress.mock.calls).toEqual([[2 / 32], [4 / 32]])
        expect(source.locked).toBe(false)
    })
    it("propagates read errors and releases the source", async () => {
        const failure = new Error("read failed")
        const source = new ReadableStream<Uint8Array>({pull() {throw failure}})
        const wrapped = network.progress(vi.fn())(responseFor(source))
        await expect(wrapped.arrayBuffer()).rejects.toBe(failure)
        expect(source.locked).toBe(false)
    })
    it("cancels and releases the source when the progress handler throws", async () => {
        const failure = new Error("handler failed")
        const cancel = vi.fn()
        const source = new ReadableStream<Uint8Array>({
            pull(controller) {controller.enqueue(new Uint8Array([1]))}, cancel
        })
        const wrapped = network.progress(() => {throw failure})(responseFor(source))
        await expect(wrapped.arrayBuffer()).rejects.toBe(failure)
        expect(cancel).toHaveBeenCalledWith(failure)
        expect(source.locked).toBe(false)
    })
    it("does not report progress for a read cancelled while pending", async () => {
        const source = new ReadableStream<Uint8Array>({pull() {}})
        const progress = vi.fn()
        const reader = network.progress(progress)(responseFor(source)).body!.getReader()
        const pending = reader.read()
        await reader.cancel()
        expect((await pending).done).toBe(true)
        expect(progress).not.toHaveBeenCalled()
        expect(source.locked).toBe(false)
    })
})
