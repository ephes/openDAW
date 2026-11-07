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
it("shares same-task loads while keeping different tasks independent and retryable", async () => {
    let complete!: (value: Uint8Array) => void
    vi.mocked(ModelStore.ensure).mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const workers: WorkerFake[] = []
    const host = new EngineHost({workerFactory: () => {const value = new WorkerFake(); workers.push(value); return value as unknown as Worker}})
    const a = host.ensureLoaded("a", model, [])
    const a2 = host.ensureLoaded("a", model, [])
    const b = host.ensureLoaded("b", model, [])
    const done = Promise.allSettled([a, a2, b])
    try {
        await tick()
        expect(ModelStore.ensure).toHaveBeenCalledTimes(2)
        expect(workers[0].messages.filter(msg => msg.kind === "load" && msg.taskKey === "b")).toHaveLength(1)
    } finally {complete(new Uint8Array([1])); await done; await host.shutdown()}
    expect(workers[0].messages.filter(msg => msg.kind === "load" && msg.taskKey === "a")).toHaveLength(1)
})
it("cancels one load waiter without retiring a shared load", async () => {
    let complete!: (value: Uint8Array) => void
    vi.mocked(ModelStore.ensure).mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const host = new EngineHost({workerFactory: () => new WorkerFake() as unknown as Worker})
    const controller = new AbortController()
    const reason = new Error("synthetic cancelled")
    const first = host.ensureLoaded("a", model, [], {signal: controller.signal})
    const cancelled = first.catch(error => error)
    const second = host.ensureLoaded("a", model, [])
    controller.abort(reason)
    try {
        await tick()
        let settled = false
        void cancelled.then(() => {settled = true})
        await tick()
        expect(settled).toBe(true)
        expect(await cancelled).toBe(reason)
    } finally {complete(new Uint8Array([1])); await Promise.allSettled([first, second]); await host.shutdown()}
    expect(ModelStore.ensure).toHaveBeenCalledTimes(1)
})
it("rejects pre-aborted loaded shortcuts without work and preserves the reason", async () => {
    const host = new EngineHost({workerFactory: () => new WorkerFake() as unknown as Worker})
    await host.ensureLoaded("t", model, [])
    const controller = new AbortController(); const reason = new Error("synthetic abort"); controller.abort(reason)
    await expect(host.ensureLoaded("t", model, [], {signal: controller.signal})).rejects.toBe(reason)
    expect(ModelStore.ensure).toHaveBeenCalledTimes(1)
    await host.shutdown()
})
it("releases after queued runs and reports disposal failures to the caller", async () => {
    const worker = new WorkerFake()
    const host = new EngineHost({workerFactory: () => worker as unknown as Worker})
    await host.ensureLoaded("t", model, [])
    worker.held = true
    const running = host.enqueue(() => host.sessionRunFor("t", Option.None)({}))
    await tick()
    const released = host.releaseTask("t")
    const releaseOutcome = released.catch(error => error)
    try {
        await tick()
        expect(worker.messages.some(msg => msg.kind === "release")).toBe(false)
        worker.emit({kind: "result", id: worker.messages.find(msg => msg.kind === "run")!.id, output: {}})
        await running
        await tick()
        const message = worker.messages.find(msg => msg.kind === "release")!
        expect(message).toBeDefined()
        worker.emit({kind: "error", id: message.id, message: "synthetic disposal"})
        await expect(releaseOutcome).resolves.toMatchObject({message: "synthetic disposal"})
        await host.ensureLoaded("t", model, [])
        expect(worker.messages.filter(msg => msg.kind === "load")).toHaveLength(2)
    } finally {await host.shutdown(); await Promise.allSettled([running, released])}
})
it("retries a failed shared load", async () => {
    vi.mocked(ModelStore.ensure).mockRejectedValueOnce(new Error("synthetic load"))
    const host = new EngineHost({workerFactory: () => new WorkerFake() as unknown as Worker})
    await expect(host.ensureLoaded("t", model, [])).rejects.toThrow("synthetic load")
    await host.ensureLoaded("t", model, [])
    expect(ModelStore.ensure).toHaveBeenCalledTimes(2)
    await host.shutdown()
})
it("shutdown retires waiting loads even when the storage adapter is delayed", async () => {
    const held = Promise.withResolvers<Uint8Array>()
    vi.mocked(ModelStore.ensure).mockReturnValueOnce(held.promise)
    const factory = vi.fn(() => new WorkerFake() as unknown as Worker)
    const host = new EngineHost({workerFactory: factory})
    let failure: unknown
    const load = host.ensureLoaded("t", model, []).catch(error => {failure = error})
    try {
        await tick(); await host.shutdown(); await tick()
        expect(failure).toMatchObject({message: expect.stringContaining("shut down")})
        expect(factory).not.toHaveBeenCalled()
    } finally {held.resolve(new Uint8Array([1])); await load}
})

it("aborts a shared download only after its final waiter cancels, then permits retry", async () => {
    const held = Promise.withResolvers<Uint8Array>()
    let downloadSignal: AbortSignal | undefined
    vi.mocked(ModelStore.ensure).mockImplementationOnce((_key, _model, options) => {downloadSignal = options?.signal; return held.promise})
    const factory = vi.fn(() => new WorkerFake() as unknown as Worker)
    const host = new EngineHost({workerFactory: factory})
    const a = new AbortController(); const b = new AbortController()
    const first = host.ensureLoaded("t", model, [], {signal: a.signal})
    const second = host.ensureLoaded("t", model, [], {signal: b.signal})
    const outcomes = Promise.allSettled([first, second])
    await tick()
    a.abort(new Error("first")); await tick()
    expect(downloadSignal?.aborted).toBe(false)
    b.abort(new Error("last")); await tick()
    expect(downloadSignal?.aborted).toBe(true)
    held.resolve(new Uint8Array([1])); await outcomes; await tick()
    expect(factory).not.toHaveBeenCalled()
    await host.ensureLoaded("t", model, [])
    expect(factory).toHaveBeenCalledTimes(1)
    await host.shutdown()
})
it("release during a failed load is an idempotent no-op", async () => {
    const held = Promise.withResolvers<Uint8Array>()
    vi.mocked(ModelStore.ensure).mockReturnValueOnce(held.promise)
    const host = new EngineHost({workerFactory: () => new WorkerFake() as unknown as Worker})
    const loading = host.ensureLoaded("t", model, []).catch(error => error)
    const releasing = host.releaseTask("t")
    const released = releasing.catch(error => error)
    await tick(); held.reject(new Error("synthetic load failure"))
    await expect(loading).resolves.toMatchObject({message: "synthetic load failure"})
    await expect(released).resolves.toBeUndefined()
    await host.shutdown()
})
