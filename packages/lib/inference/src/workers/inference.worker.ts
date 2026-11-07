/// <reference lib="webworker" />
import {asDefined, isDefined, panic} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {InferenceSession, Tensor as OrtTensor, env as ortEnv} from "onnxruntime-web"
import {Tensor, TensorElementType, TensorMap} from "../Tensor"
import {MainToWorker, WorkerToMain} from "./protocol"

const sessions = new Map<string, InferenceSession>()

const post = (message: WorkerToMain): void => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(message)
}

const toOrtType = (type: TensorElementType): OrtTensor.Type => {
    switch (type) {
        case "float32": return "float32"
        case "int32":   return "int32"
        case "int64":   return "int64"
    }
}

const toOrtElementType = (type: OrtTensor.Type): TensorElementType => {
    switch (type) {
        case "float32": return "float32"
        case "int32":   return "int32"
        case "int64":   return "int64"
        default:        return panic(`Unsupported tensor element type: ${type}`)
    }
}

const toOrtTensor = (input: Tensor): OrtTensor => {
    return new OrtTensor(toOrtType(input.type), input.data, [...input.dims])
}

const fromOrtTensor = (output: OrtTensor): Tensor => {
    const data = output.data
    if (data instanceof Float32Array || data instanceof Int32Array || data instanceof BigInt64Array) {
        return {type: toOrtElementType(output.type), data, dims: [...output.dims]}
    }
    return panic(`Unsupported tensor output data type: ${output.type}`)
}

const toOrtFeeds = (feeds: TensorMap): Record<string, OrtTensor> => {
    const result: Record<string, OrtTensor> = {}
    for (const name of Object.keys(feeds)) {
        result[name] = toOrtTensor(feeds[name])
    }
    return result
}

const fromOrtResults = (output: InferenceSession.OnnxValueMapType): TensorMap => {
    const result: Record<string, Tensor> = {}
    for (const name of Object.keys(output)) {
        const tensor = output[name]
        if (tensor instanceof OrtTensor) {
            result[name] = fromOrtTensor(tensor)
        }
    }
    return result
}

const handleLoad = async (msg: Extract<MainToWorker, {kind: "load"}>): Promise<void> => {
    let session = sessions.get(msg.taskKey)
    if (!isDefined(session)) {
        session = await InferenceSession.create(msg.modelBytes, {
            executionProviders: [...msg.executionProviders, "wasm"]
        })
        sessions.set(msg.taskKey, session)
    }
    post({kind: "loaded", id: msg.id, inputs: session.inputNames, outputs: session.outputNames})
}

const handleRun = async (msg: Extract<MainToWorker, {kind: "run"}>): Promise<void> => {
    const session = asDefined(sessions.get(msg.taskKey), `Session not loaded for task: ${msg.taskKey}`)
    const feeds = toOrtFeeds(msg.feeds)
    const output = await session.run(feeds)
    post({kind: "result", id: msg.id, output: fromOrtResults(output)})
}

const handleRelease = async (msg: Extract<MainToWorker, {kind: "release"}>): Promise<void> => {
    const session = sessions.get(msg.taskKey)
    if (isDefined(session)) {
        try {await session.release()} finally {sessions.delete(msg.taskKey)}
    }
    post({kind: "ok", id: msg.id})
}

const handleShutdown = (msg: Extract<MainToWorker, {kind: "shutdown"}>): void => {
    for (const [key, session] of sessions) {
        session.release().catch(() => {})
        sessions.delete(key)
    }
    post({kind: "ok", id: msg.id})
}

const runHandler = async (msg: MainToWorker): Promise<void> => {
    switch (msg.kind) {
        case "load":     return handleLoad(msg)
        case "run":      return handleRun(msg)
        case "release":  return handleRelease(msg)
        case "shutdown": return handleShutdown(msg)
    }
}

const dispatch = async (msg: MainToWorker): Promise<void> => {
    const result = await Promises.tryCatch(runHandler(msg))
    if (result.status === "rejected") {
        const reason = result.error
        const message = reason instanceof Error ? reason.message : String(reason)
        post({kind: "error", id: msg.id, message})
    }
}

const taskQueues = new Map<string, Promise<void>>()
let closing = false
self.addEventListener("message", (event: MessageEvent<MainToWorker>) => {
    const msg = event.data
    if (closing) {post({kind: "error", id: msg.id, message: "Inference worker shutting down"}); return}
    if (msg.kind === "shutdown") {
        closing = true
        void Promise.allSettled([...taskQueues.values()]).then(() => dispatch(msg))
        return
    }
    const task = (taskQueues.get(msg.taskKey) ?? Promise.resolve()).catch(() => {}).then(() => dispatch(msg))
    taskQueues.set(msg.taskKey, task)
    const cleanup = () => {if (taskQueues.get(msg.taskKey) === task) {taskQueues.delete(msg.taskKey)}}
    void task.then(cleanup, cleanup)
})

ortEnv.wasm.numThreads = Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1)

post({kind: "ready"})
