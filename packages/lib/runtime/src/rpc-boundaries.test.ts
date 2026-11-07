import {afterEach, expect, it} from "vitest"
import {Messenger, Port} from "./messenger"
import {Communicator} from "./communicator"
import {Terminable} from "@opendaw/lib-std"
const owned: Terminable[] = []
afterEach(() => {while (owned.length > 0) {owned.pop()!.terminate()}})
const flush = async () => {for (let i = 0; i < 12; i++) {await Promise.resolve()}}
const pair = () => {
    const errors: unknown[] = []
    const a: Port = {onmessage: null, onmessageerror: null, postMessage: message => deliver(b, message)}
    const b: Port = {onmessage: null, onmessageerror: null, postMessage: message => deliver(a, message)}
    const deliver = (port: Port, data: unknown) => queueMicrotask(() => {
        try {port.onmessage?.({data: structuredClone(data)} as MessageEvent)} catch (error) {errors.push(error)}
    })
    const left = Messenger.for(a), right = Messenger.for(b)
    owned.push(left, right)
    return {left, right, errors}
}
for (const name of ["missing", "toString", "constructor", "hasOwnProperty", "__proto__", "hidden"]) {
    it(`settles a request for disallowed method ${name}`, async () => {
        const {left, right, errors} = pair()
        class Base {async hidden() {return "hidden"}}
        class Protocol extends Base {async valid() {return 42}}
        owned.push(Communicator.executor(right, new Protocol()))
        const sender = Communicator.sender(left, dispatcher => dispatcher)
        const func = {[name]: async () => undefined}[name]
        let outcome = "pending"
        sender.dispatchAndReturn(func).then(() => {outcome = "resolved"}, () => {outcome = "rejected"})
        await flush()
        expect(outcome).toBe("rejected")
        expect(errors).toEqual([])
    })
}
it("rejects malformed request arguments with a valid return ID", async () => {
    const {left, right, errors} = pair()
    let called = 0
    owned.push(Communicator.executor(right, {async valid() {called++; return 42}}))
    const replies: {type: string, returnId: number}[] = []
    left.subscribe((reply: {type: string, returnId: number}) => replies.push(reply))
    const args = [null, {}, [{callback: -1}], [{value: 1, callback: 0}], [null]]
    args.forEach((value, returnId) => left.send({type: "send", returnId, func: "valid", args: value}))
    left.send({type: "send", returnId: 100, func: 123, args: []})
    left.send({type: "other", returnId: 101, func: "valid", args: []})
    await flush()
    expect(replies).toHaveLength(7)
    expect(replies.every(reply => reply.type === "reject")).toBe(true)
    expect(called).toBe(0)
    expect(errors).toEqual([])
})
it("keeps valid methods, callbacks and fire-and-forget calls working", async () => {
    const {left, right, errors} = pair()
    const notices: number[] = [], callbacks: number[] = []
    owned.push(Communicator.executor(right, {
        notify(value: number) {notices.push(value)},
        async run(progress: (value: number) => void) {progress(0.5); return 42}
    }))
    const sender = Communicator.sender(left, dispatcher => dispatcher)
    const result = sender.dispatchAndReturn(async function run(_progress: (value: number) => void) {}, n => callbacks.push(n))
    sender.dispatchAndForget(function notify(_value: number) {}, 7)
    await expect(result).resolves.toBe(42)
    expect(notices).toEqual([7]); expect(callbacks).toEqual([0.5]); expect(errors).toEqual([])
})
it("isolates malformed channel envelopes and delivers only to the intended sibling", async () => {
    const {left, right, errors} = pair()
    const a = right.channel("a"), b = right.channel("b")
    owned.push(a, b)
    const seenA: unknown[] = [], seenB: unknown[] = []
    a.subscribe(x => seenA.push(x)); b.subscribe(x => seenB.push(x))
    for (const data of [null, "text", 1, true, [], {}, {__id__: "42"},
        {__id__: "42", channel: 7, message: "bad"}, {__id__: 42, channel: "a", message: "bad"},
        Object.assign([], {__id__: "42", channel: "a", message: "bad"})]) {left.send(data)}
    const sendA = left.channel("a"); owned.push(sendA); sendA.send("valid")
    await flush()
    expect(errors).toEqual([])
    expect(seenA).toEqual(["valid"]); expect(seenB).toEqual([])
})
