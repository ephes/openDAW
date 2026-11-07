import {asDefined, isDefined, Option, panic, Procedure, Provider, unitValue} from "@opendaw/lib-std"
import {ExecutionProvider, ModelDescriptor, TaskDefinition} from "./Task"
import {SessionRun, TensorMap} from "./Tensor"
import {InferenceCancelledError} from "./Errors"
import {ModelStore} from "./ModelStore"
import {MainToWorker, WorkerCallId, WorkerToMain} from "./workers/protocol"

interface PendingCall {
    readonly id: WorkerCallId
    readonly resolve: (value: unknown) => void
    readonly reject: (reason: unknown) => void
}

interface QueueEntry {
    readonly cancel: (reason: unknown) => void
    readonly run: () => Promise<void>
}

const NO_PROGRESS: Procedure<unitValue> = () => {}

export interface EngineHostOptions {
    readonly workerFactory: Provider<Worker>
}

export interface SessionNames {
    readonly inputs: ReadonlyArray<string>
    readonly outputs: ReadonlyArray<string>
}

export class EngineHost {
    readonly #workerFactory: Provider<Worker>
    readonly #pending = new Map<WorkerCallId, PendingCall>()
    readonly #loadedTasks = new Set<string>()
    readonly #names = new Map<string, SessionNames>()
    readonly #queue: Array<QueueEntry> = []
    readonly #lifetime = new AbortController()
    #worker: Option<Worker> = Option.None
    #ready: Option<Promise<void>> = Option.None
    #nextCallId: WorkerCallId = 1
    #processing = false
    #closed = false
    #generation = 0
    #cleanupWorker: (() => void) | undefined
    #rejectReady: ((reason: unknown) => void) | undefined
    #active: QueueEntry | undefined

    constructor(options: EngineHostOptions) {this.#workerFactory = options.workerFactory}

    async ensureLoaded(taskKey: string, model: ModelDescriptor,
                       executionProviders: ReadonlyArray<ExecutionProvider>,
                       options?: {progress?: Procedure<unitValue>, signal?: AbortSignal}): Promise<void> {
        this.#assertOpen()
        if (this.#loadedTasks.has(taskKey)) {options?.progress?.(1.0); return}
        const signal = options?.signal ? AbortSignal.any([options.signal, this.#lifetime.signal]) : this.#lifetime.signal
        const modelBytes = await ModelStore.ensure(taskKey, model, {...options, signal})
        this.#assertOpen()
        await this.#ensureWorker()
        const generation = this.#generation
        this.#throwIfAborted(options?.signal)
        const ack = await this.#dispatch<Extract<WorkerToMain, {kind: "loaded"}>>({
            kind: "load", id: this.#nextId(), taskKey, model, modelBytes, executionProviders
        })
        this.#assertOpen()
        if (generation !== this.#generation) {throw new Error("Inference worker retired; retry")}
        this.#names.set(taskKey, {inputs: ack.inputs, outputs: ack.outputs})
        this.#loadedTasks.add(taskKey)
    }

    namesFor(taskKey: string): SessionNames {
        const names = this.#names.get(taskKey)
        if (isDefined(names)) {return names}
        return panic(`Session names not available for task: ${taskKey}`)
    }

    sessionRunFor(taskKey: string, signal: Option<AbortSignal>): SessionRun {
        return async (feeds: TensorMap): Promise<TensorMap> => {
            this.#throwIfAborted(signal.unwrapOrUndefined())
            const result = await this.#dispatch<Extract<WorkerToMain, {kind: "result"}>>({
                kind: "run", id: this.#nextId(), taskKey, feeds
            })
            return result.output
        }
    }

    enqueue<O>(work: (release: () => void) => Promise<O>): Promise<O> {
        if (this.#closed) {return Promise.reject(new Error("Inference host shut down"))}
        return new Promise<O>((resolve, reject) => {
            const entry: QueueEntry = {
                cancel: reject,
                run: async () => {
                    try {this.#assertOpen(); resolve(await work(() => {}))}
                    catch (error) {reject(error)}
                }
            }
            this.#queue.push(entry)
            void this.#drain()
        })
    }

    async releaseTask(taskKey: string): Promise<void> {
        this.#assertOpen()
        if (!this.#loadedTasks.has(taskKey)) {return}
        await this.#dispatch<Extract<WorkerToMain, {kind: "ok"}>>({kind: "release", id: this.#nextId(), taskKey})
        this.#loadedTasks.delete(taskKey)
        this.#names.delete(taskKey)
    }

    async shutdown(): Promise<void> {
        if (this.#closed) {return}
        this.#closed = true
        const error = new Error("Inference host shut down")
        this.#lifetime.abort(error)
        this.#active?.cancel(error)
        for (const entry of this.#queue.splice(0)) {entry.cancel(error)}
        // Best effort only: termination bounds shutdown even if the worker never acknowledges.
        this.#worker.ifSome(worker => {
            try {worker.postMessage({kind: "shutdown", id: this.#nextId()})} catch { /* Already failed. */ }
        })
        this.#retire(error)
    }

    async #drain(): Promise<void> {
        if (this.#processing || this.#closed) {return}
        this.#processing = true
        try {
            while (!this.#closed && this.#queue.length > 0) {
                const entry = asDefined(this.#queue.shift())
                this.#active = entry
                await entry.run()
                this.#active = undefined
            }
        } finally {this.#processing = false}
    }

    #ensureWorker(): Promise<void> {
        this.#assertOpen()
        if (this.#ready.nonEmpty()) {return this.#ready.unwrap()}
        const worker = this.#workerFactory()
        this.#worker = Option.wrap(worker)
        const promise = new Promise<void>((resolve, reject) => {
            this.#rejectReady = reject
            let ready = false
            const current = () => this.#worker.contains(worker)
            const fail = (event?: Event | string) => {
                if (!current()) {return}
                const detail = typeof event === "string" ? event : event && "message" in event && typeof event.message === "string" ? event.message : ""
                this.#retire(new Error(`Inference worker failed; retry${detail ? `: ${detail.slice(0, 300)}` : ""}`))
            }
            const onMessage = (event: MessageEvent<WorkerToMain>) => {
                if (!current()) {return}
                if (!ready) {
                    if (event.data.kind === "ready") {ready = true; this.#rejectReady = undefined; resolve()}
                    else if (event.data.kind === "error") {fail(event.data.message)}
                    return
                }
                this.#onMessage(event)
            }
            this.#cleanupWorker = () => {
                worker.removeEventListener("message", onMessage as EventListener)
                worker.removeEventListener("error", fail)
                worker.removeEventListener("messageerror", fail)
            }
            worker.addEventListener("message", onMessage as EventListener)
            worker.addEventListener("error", fail)
            worker.addEventListener("messageerror", fail)
        })
        this.#ready = Option.wrap(promise)
        return promise
    }

    #retire(error: Error): void {
        ++this.#generation
        this.#cleanupWorker?.()
        this.#cleanupWorker = undefined
        const worker = this.#worker
        this.#worker = Option.None
        this.#ready = Option.None
        const reject = this.#rejectReady
        this.#rejectReady = undefined
        reject?.(error)
        for (const pending of this.#pending.values()) {pending.reject(error)}
        this.#pending.clear()
        this.#loadedTasks.clear()
        this.#names.clear()
        worker.ifSome(value => value.terminate())
    }

    readonly #onMessage = (event: MessageEvent<WorkerToMain>): void => {
        const msg = event.data
        if (msg.kind === "ready") {return}
        const pending = this.#pending.get(msg.id)
        if (!pending) {return}
        this.#pending.delete(msg.id)
        if (msg.kind === "error") {pending.reject(new Error(msg.message))}
        else {pending.resolve(msg)}
    }

    async #dispatch<R extends WorkerToMain>(message: MainToWorker): Promise<R> {
        this.#assertOpen()
        await this.#ensureWorker()
        this.#assertOpen()
        const worker = this.#worker.unwrap()
        return new Promise<R>((resolve, reject) => {
            this.#pending.set(message.id, {id: message.id, resolve: resolve as (value: unknown) => void, reject})
            try {worker.postMessage(message)}
            catch (error) {this.#pending.delete(message.id); reject(error)}
        })
    }

    #nextId(): WorkerCallId {return this.#nextCallId++}
    #assertOpen(): void {if (this.#closed) {throw new Error("Inference host shut down")}}
    #throwIfAborted(signal: AbortSignal | undefined): void {
        if (signal?.aborted) {throw new InferenceCancelledError()}
    }
}

export interface RunArgs<I, O> {
    readonly task: TaskDefinition<I, O>
    readonly input: I
    readonly progress: Procedure<unitValue>
    readonly signal: Option<AbortSignal>
    readonly executionProviders: ReadonlyArray<ExecutionProvider>
    /**
     * Fraction of the overall progress that the download / session-load phase
     * occupies. Defaults to 0.5 (download ↔ inference split). Pass 0 if the
     * caller has already preloaded the session (download is a guaranteed
     * cache hit) and the dialog should map 0..1 directly to inference.
     */
    readonly downloadShare?: number
}

export const splitProgress = (
    overall: Procedure<unitValue> | undefined,
    downloadShare: unitValue
): {download: Procedure<unitValue>, inference: Procedure<unitValue>} => {
    const handler = overall ?? NO_PROGRESS
    return {
        download:  (value: unitValue): void => handler(value * downloadShare),
        inference: (value: unitValue): void => handler(downloadShare + value * (1 - downloadShare))
    }
}

export const runTask = async <I, O>(host: EngineHost, args: RunArgs<I, O>): Promise<O> => {
    const overall = args.progress
    const share = args.downloadShare ?? 0.5
    const split = splitProgress(overall, share)
    await host.ensureLoaded(args.task.key, args.task.model, args.executionProviders, {
        progress: split.download,
        signal: args.signal.unwrapOrUndefined()
    })
    const session = host.sessionRunFor(args.task.key, args.signal)
    const names = host.namesFor(args.task.key)
    return args.task.run(args.input, {
        session,
        progress: split.inference,
        signal: args.signal,
        inputNames: names.inputs,
        outputNames: names.outputs
    })
}
