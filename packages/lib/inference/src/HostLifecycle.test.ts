import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {EngineHost} from "./EngineHost"
import {ModelStore} from "./ModelStore"
import {MainToWorker, WorkerToMain} from "./workers/protocol"
class WorkerFake extends EventTarget {
    readonly messages: MainToWorker[] = []
    readonly terminate = vi.fn()
    held = false
    constructor(readonly startup: "ready" | "error" | "protocol" = "ready") {
        super()
    }
    #started = false
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
        super.addEventListener(type, listener, options)
        if (type === "message" && !this.#started) {
            this.#started = true
            queueMicrotask(() => {
                if (this.startup === "ready") {this.emit({kind: "ready"})}
                else if (this.startup === "protocol") {this.emit({kind: "error", id: 0, message: "synthetic initialization detail"})}
                else {this.dispatchEvent(Object.assign(new Event("error"), {message: "synthetic startup detail"}))}
            })
        }
    }
    emit(data: WorkerToMain) {this.dispatchEvent(new MessageEvent("message", {data}))}
    postMessage(message: MainToWorker) {
        this.messages.push(message)
        if (message.kind === "load") {queueMicrotask(() => this.emit({kind: "loaded", id: message.id, inputs: [], outputs: []}))}
        if (message.kind === "run" && !this.held) {queueMicrotask(() => this.emit({kind: "result", id: message.id, output: {}}))}
    }
}
const model = {url: "https://synthetic.invalid", sha256: "0".repeat(64), bytes: 1, version: "v1"}
beforeEach(() => {vi.spyOn(ModelStore, "ensure").mockResolvedValue(new Uint8Array([1]))})
afterEach(() => vi.restoreAllMocks())
const tick = async () => {for (let i = 0; i < 12; i++) {await Promise.resolve()}}
it("settles synchronous throws, async failures, and the following job", async () => {
    const host = new EngineHost({workerFactory: () => new WorkerFake() as unknown as Worker})
    const results: unknown[] = []
    void host.enqueue(() => {throw new Error("sync")}).catch(error => results.push(error.message))
    void host.enqueue(async () => {throw new Error("async")}).catch(error => results.push(error.message))
    void host.enqueue(async () => 42).then(value => results.push(value))
    await tick()
    expect(results).toEqual(["sync", "async", 42])
    await host.shutdown()
})
for (const type of ["error", "messageerror"]) {
    it(`settles runtime ${type}, retires listeners, and retries with a new worker`, async () => {
        const workers: WorkerFake[] = []
        const host = new EngineHost({workerFactory: () => {const worker = new WorkerFake(); workers.push(worker); return worker as unknown as Worker}})
        await host.ensureLoaded("t", model, [])
        workers[0].held = true
        let failure: unknown
        const run = host.sessionRunFor("t", Option.None)({}).catch(error => {failure = error})
        await tick()
        workers[0].dispatchEvent(Object.assign(new Event(type), {message: "synthetic runtime detail"}))
        await tick()
        expect(failure).toMatchObject({message: expect.stringContaining("synthetic runtime detail")})
        expect(workers[0].terminate).toHaveBeenCalledTimes(1)
        await run
        await host.ensureLoaded("t", model, [])
        expect(workers).toHaveLength(2)
        await host.shutdown()
    })
}
it("cleans startup failure and creates a fresh worker on retry", async () => {
    const workers: WorkerFake[] = []
    const host = new EngineHost({workerFactory: () => {const worker = new WorkerFake(workers.length === 0 ? "error" : "ready"); workers.push(worker); return worker as unknown as Worker}})
    await expect(host.ensureLoaded("t", model, [])).rejects.toThrow("synthetic startup detail")
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
    await host.ensureLoaded("t", model, [])
    expect(workers).toHaveLength(2)
    await host.shutdown()
})
it("shutdown settles active/queued calls without an acknowledgement and rejects later work", async () => {
    const worker = new WorkerFake()
    const host = new EngineHost({workerFactory: () => worker as unknown as Worker})
    await host.ensureLoaded("t", model, [])
    worker.held = true
    const outcomes: unknown[] = []
    void host.enqueue(() => host.sessionRunFor("t", Option.None)({})).catch(error => outcomes.push(error))
    const queued = vi.fn(async () => 1)
    void host.enqueue(queued).catch(error => outcomes.push(error))
    await tick()
    let stopped = false
    void host.shutdown().then(() => {stopped = true})
    await tick()
    expect(stopped).toBe(true)
    expect(outcomes).toHaveLength(2)
    expect(queued).not.toHaveBeenCalled()
    await expect(host.enqueue(async () => 2)).rejects.toThrow(/shut down/)
    const run = worker.messages.find(message => message.kind === "run")!
    worker.emit({kind: "result", id: run.id, output: {}})
    await tick()
    expect(outcomes).toHaveLength(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it("preserves bounded startup protocol error detail", async () => {
    const host = new EngineHost({workerFactory: () => new WorkerFake("protocol") as unknown as Worker})
    await expect(host.ensureLoaded("t", model, [])).rejects.toThrow("synthetic initialization detail")
    await host.shutdown()
})
