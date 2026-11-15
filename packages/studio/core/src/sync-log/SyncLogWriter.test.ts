import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {RuntimeNotifier, Terminable, Terminator} from "@opendaw/lib-std"
import type {BoxGraph, TransactionListener, UpdateListener, Update} from "@opendaw/lib-box"
import type {Project} from "../project/Project"
import {Commit} from "./Commit"
import {SyncLogWriter} from "./SyncLogWriter"

const flush = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve()}}
const commit = {thisHash: new ArrayBuffer(32)} as Commit
const fixture = () => {
    let transaction: TransactionListener | undefined
    const captures = new Set<{onUpdate(update: Update): unknown}>()
    const transactionOff = vi.fn(() => {transaction = undefined})
    const captureOff = vi.fn()
    const boxGraph = {
        subscribeTransaction: (listener: TransactionListener) => {transaction = listener; return {terminate: transactionOff}},
        subscribeToAllUpdatesImmediate: (listener: UpdateListener) => {
            captures.add(listener)
            return {terminate: () => {if (captures.delete(listener)) {captureOff()}}}
        }
    } as unknown as BoxGraph
    const lifecycle = new Terminator()
    const project = {boxGraph, rootBox: {created: {getValue: () => 0}}, own: (value: Terminable) => lifecycle.own(value)} as unknown as Project
    return {project, captures, transactionOff, captureOff,
        begin: () => transaction?.onBeginTransaction(),
        end: () => transaction?.onEndTransaction(false),
        update: () => captures.forEach(listener => listener.onUpdate({} as Update))}
}
beforeEach(() => {
    vi.spyOn(Commit, "createFirst").mockResolvedValue(commit)
    vi.spyOn(Commit, "createOpen").mockResolvedValue(commit)
    vi.spyOn(Commit, "createUpdate").mockResolvedValue(commit)
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
})
afterEach(() => vi.restoreAllMocks())

describe("recovery log capture lifetime", () => {
    it("retires active capture and drops pending updates on repeated termination", async () => {
        const scene = fixture()
        const observer = vi.fn()
        const writer = SyncLogWriter.attach(scene.project, observer, commit)
        await flush()
        scene.begin()
        scene.update()
        expect(scene.captures.size).toBe(1)
        writer.terminate()
        writer.terminate()
        expect(scene.captures.size).toBe(0)
        expect(scene.captureOff).toHaveBeenCalledOnce()
        scene.end()
        scene.begin()
        scene.update()
        scene.end()
        await flush()
        expect(Commit.createUpdate).not.toHaveBeenCalled()
        expect(observer).toHaveBeenCalledOnce()
    })
    it.each(["hash", "observer", "async observer"])("publishes one terminal %s failure and stops the hash chain", async cause => {
        const scene = fixture()
        const failure = new Error("synthetic recovery failure")
        const observer = vi.fn((): unknown => {
            if (cause === "observer") {throw failure}
            if (cause === "async observer") {return Promise.reject(failure)}
        })
        if (cause === "hash") {vi.mocked(Commit.createOpen).mockRejectedValueOnce(failure)}
        const writer = SyncLogWriter.attach(scene.project, observer, commit)
        scene.begin()
        scene.update()
        scene.end() // Queue one completed transaction before the failure settles.
        scene.begin()
        scene.update()
        await flush()
        expect(writer.error.unwrap()).toBe(failure)
        expect(RuntimeNotifier.info).toHaveBeenCalledOnce()
        expect(scene.captures.size).toBe(0)
        expect(scene.transactionOff).toHaveBeenCalledOnce()
        for (let i = 0; i < 3; i++) {scene.end(); scene.begin(); scene.update(); scene.end()}
        await flush()
        expect(Commit.createUpdate).not.toHaveBeenCalled()
        expect(RuntimeNotifier.info).toHaveBeenCalledOnce()
    })
})


it("captures the initial graph synchronously and reports an initial hash failure once", async () => {
    const scene = fixture()
    const failure = new Error("initial hash")
    vi.mocked(Commit.createFirst).mockRejectedValueOnce(failure)
    const writer = SyncLogWriter.attach(scene.project, vi.fn())
    expect(Commit.createFirst).toHaveBeenCalledOnce()
    scene.begin()
    scene.update()
    await flush()
    expect(writer.error.unwrap()).toBe(failure)
    expect(Commit.createOpen).not.toHaveBeenCalled()
    expect(Commit.createUpdate).not.toHaveBeenCalled()
    expect(RuntimeNotifier.info).toHaveBeenCalledOnce()
    expect(scene.captures.size).toBe(0)
})


it("waits for observer acknowledgement before hashing the next queued commit", async () => {
    const scene = fixture()
    const acknowledged = Promise.withResolvers<void>()
    const observer = vi.fn(() => acknowledged.promise)
    const writer = SyncLogWriter.attach(scene.project, observer, commit)
    scene.begin()
    scene.update()
    scene.end()
    await flush()
    expect(observer).toHaveBeenCalledOnce()
    expect(Commit.createUpdate).not.toHaveBeenCalled()
    acknowledged.resolve()
    await flush()
    expect(Commit.createUpdate).toHaveBeenCalledOnce()
    expect(observer).toHaveBeenCalledTimes(2)
    expect(writer.error.isEmpty()).toBe(true)
    writer.terminate()
})
