import {describe, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {Communicator, Messenger, Port} from "@opendaw/lib-runtime"
import {Address} from "./address"
import {createSyncTarget} from "./sync-target"
import {SyncSource} from "./sync-source"
import {Synchronization, UpdateTask} from "./sync"
import {graph, TestBox} from "./testing/fixtures"

const paired = () => {
    const a: Port = {onmessage: null, onmessageerror: null, postMessage: message => b.onmessage?.({data: structuredClone(message)} as MessageEvent)}
    const b: Port = {onmessage: null, onmessageerror: null, postMessage: message => a.onmessage?.({data: structuredClone(message)} as MessageEvent)}
    return [Messenger.for(a), Messenger.for(b)] as const
}
const caller = (messenger: Messenger): Synchronization<unknown> => Communicator.sender(messenger, ({dispatchAndForget, dispatchAndReturn}) => ({
    sendUpdates(updates) {dispatchAndForget(this.sendUpdates, updates)},
    checksum(value) {return dispatchAndReturn(this.checksum, value)}
}))
const fixture = () => {
    const source = graph()
    source.beginTransaction()
    const box = TestBox.create(source)
    source.endTransaction()
    const target = graph()
    target.fromArrayBuffer(source.toArrayBuffer())
    const [a, b] = paired()
    createSyncTarget(target, b)
    return {source, target, box, sender: caller(a), a}
}

describe("replication batch boundaries", () => {
    it.each(["missing vertex", "truncated box"])("rolls back valid edits before %s and accepts the next batch", kind => {
        const {target, box, sender} = fixture()
        const before = target.checksum()
        const invalid: UpdateTask<unknown> = kind === "missing vertex"
            ? {type: "update-primitive", address: Address.compose(UUID.generate(), 0).decompose(), value: true}
            : {type: "new", name: "TestBox" as never, uuid: UUID.generate(), buffer: new ArrayBuffer(0)}
        expect(() => sender.sendUpdates([
            {type: "update-primitive", address: box.getField(0).address.decompose(), value: true}, invalid
        ])).toThrow()
        expect(target.checksum()).toEqual(before)
        expect(target.inTransaction()).toBe(false)
        sender.sendUpdates([{type: "update-primitive", address: box.getField(1).address.decompose(), value: "next"}])
        expect((target.boxes()[0] as TestBox).getField(1).getValue()).toBe("next")
    })

    it("does not abort an existing caller transaction", () => {
        const {target, sender} = fixture()
        target.beginTransaction()
        expect(() => sender.sendUpdates([])).toThrow("Transaction already in progress")
        expect(target.inTransaction()).toBe(true)
        target.abortTransaction()
    })

    it.each([
        {type: "future-op"},
        {type: "update-pointer", address: "primitive", target: null},
        {type: "update-primitive", address: "pointer", value: true},
        {type: "update-primitive", address: [new Uint8Array(3), new Int16Array([0])], value: true},
        {type: "update-primitive", address: "primitive", value: "wrong boolean"},
        {type: "delete", uuid: []},
        null
    ])("refuses malformed or incompatible updates atomically: %j", bad => {
        const {target, box, sender} = fixture()
        const before = target.checksum()
        const invalid = bad === null ? null : {...bad, ...("address" in bad && typeof bad.address === "string"
            ? {address: box.getField(bad.address === "pointer" ? 2 : 0).address.decompose()} : {})}
        expect(() => sender.sendUpdates([
            {type: "update-primitive", address: box.getField(1).address.decompose(), value: "partial"},
            invalid as UpdateTask<unknown>
        ])).toThrow()
        expect(target.checksum()).toEqual(before)
        expect(target.inTransaction()).toBe(false)
    })

    it.each([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NaN, 3.4e39])("replicates the float32 value %d", value => {
        const {target, box, sender} = fixture()
        sender.sendUpdates([{type: "update-primitive", address: box.getField(3).address.decompose(), value}])
        expect((target.boxes()[0] as TestBox).getField(3).getValue()).toBe(Math.fround(value))
        expect(target.inTransaction()).toBe(false)
    })

    it("resolves updates to boxes created earlier in the same batch", () => {
        const {target, box, sender} = fixture()
        const uuid = UUID.generate()
        sender.sendUpdates([
            {type: "new", name: "TestBox" as never, uuid, buffer: box.toArrayBuffer()},
            {type: "update-primitive", address: Address.compose(uuid, 1).decompose(), value: "created"},
            {type: "update-pointer", address: box.getField(2).address.decompose(), target: Address.compose(uuid).decompose()}
        ])
        expect((target.findBox(uuid).unwrap() as TestBox).getField(1).getValue()).toBe("created")
        target.verifyPointers()
    })

    it("quarantines a failed sender, never replays a committed batch, and reconnects from a snapshot", async () => {
        const {source, target, box, a} = fixture()
        const failure = new Error("transport failed")
        const transport = vi.spyOn(a, "send").mockImplementationOnce(() => {throw failure})
        const sync = new SyncSource(source, a)
        const ended: Array<boolean> = []
        source.subscribeTransaction({onBeginTransaction: () => {}, onEndTransaction: rolledBack => ended.push(rolledBack)})
        const reported: Array<unknown> = []
        const reject = vi.spyOn(Promise, "reject").mockImplementation((reason: unknown) => {
            reported.push(reason)
            return Promise.resolve() as Promise<never>
        })
        source.beginTransaction()
        const created = TestBox.create(source)
        expect(() => source.endTransaction()).not.toThrow()
        reject.mockRestore()
        expect(reported).toEqual([failure])
        expect(ended).toEqual([false])
        expect(sync.failed).toBe(true)
        expect(source.inTransaction()).toBe(false)
        expect(source.findBox(created.address.uuid).nonEmpty()).toBe(true)
        source.beginTransaction()
        source.unstageBox(created)
        TestBox.create(source, UUID.generate(), box => box.getField(1).setValue("offline edit"))
        source.endTransaction()
        expect(transport).toHaveBeenCalledTimes(1)
        await expect(sync.checksum(source.checksum())).rejects.toThrow(/resynchron/)
        sync.terminate()
        // A new target and sender explicitly establish the new snapshot generation.
        const fresh = graph()
        const [c, d] = paired()
        createSyncTarget(fresh, d)
        const connected = new SyncSource(source, c, true)
        expect(fresh.checksum()).toEqual(source.checksum())
        source.beginTransaction()
        source.unstageBox(box)
        source.endTransaction()
        expect(fresh.checksum()).toEqual(source.checksum())
        expect(target.checksum()).not.toEqual(source.checksum())
        connected.terminate()
    })
})
