import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {MainToWorker} from "./workers/protocol"
const mocks = vi.hoisted(() => ({create: vi.fn()}))
vi.mock("onnxruntime-web", () => ({InferenceSession: {create: mocks.create}, Tensor: class {}, env: {wasm: {}}}))
let target: EventTarget & {postMessage: ReturnType<typeof vi.fn>}
const tick = async () => {for (let i = 0; i < 40; i++) {await Promise.resolve()}}
beforeEach(async () => {
    vi.resetModules(); mocks.create.mockReset()
    target = Object.assign(new EventTarget(), {postMessage: vi.fn()})
    vi.stubGlobal("self", target); vi.stubGlobal("navigator", {hardwareConcurrency: 2})
    await import("./workers/inference.worker")
})
afterEach(() => vi.unstubAllGlobals())
const send = (message: MainToWorker) => target.dispatchEvent(new MessageEvent("message", {data: message}))
const load = (id: number): MainToWorker => ({kind: "load", id, taskKey: "t", model: {url: "synthetic", sha256: "0".repeat(64), version: "v1", bytes: 1}, modelBytes: new Uint8Array([1]), executionProviders: []})
it("creates one worker session for concurrent loads of a task", async () => {
    let complete!: (value: unknown) => void
    const creation = new Promise(resolve => {complete = resolve})
    mocks.create.mockReturnValue(creation)
    send(load(1)); send(load(2)); await tick()
    try {expect(mocks.create).toHaveBeenCalledTimes(1)}
    finally {complete({inputNames: [], outputNames: [], run: vi.fn(), release: vi.fn()}); await tick()}
    expect(target.postMessage.mock.calls.filter(([msg]) => msg.kind === "loaded")).toHaveLength(2)
})
it("waits for a run and disposal before acknowledging release or creating replacement", async () => {
    let finishRun!: (value: unknown) => void
    let finishRelease!: () => void
    const running = new Promise(resolve => {finishRun = resolve})
    const releasing = new Promise<void>(resolve => {finishRelease = resolve})
    const session = {inputNames: [], outputNames: [], run: vi.fn(() => running), release: vi.fn(() => releasing)}
    mocks.create.mockResolvedValue(session)
    send(load(1)); await tick()
    send({kind: "run", id: 2, taskKey: "t", feeds: {}})
    send({kind: "release", id: 3, taskKey: "t"})
    send(load(4)); await tick()
    try {
        expect(session.release).not.toHaveBeenCalled()
        finishRun({}); await tick()
        expect(session.release).toHaveBeenCalledTimes(1)
        expect(target.postMessage.mock.calls.some(([msg]) => msg.id === 3)).toBe(false)
        expect(mocks.create).toHaveBeenCalledTimes(1)
        finishRelease(); await tick()
        expect(mocks.create).toHaveBeenCalledTimes(2)
        expect(target.postMessage.mock.calls.some(([msg]) => msg.kind === "ok" && msg.id === 3)).toBe(true)
    } finally {finishRun({}); finishRelease(); await tick()}
})
