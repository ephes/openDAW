import {describe, expect, it, vi} from "vitest"
import {Nullable, Option, Procedure, Terminator} from "@opendaw/lib-std"
import {Communicator} from "./communicator"
import {Messenger, Port} from "./messenger"

class PairedPort implements Port {
    onmessage: Nullable<Procedure<MessageEvent>> = null
    onmessageerror: Nullable<Procedure<MessageEvent>> = null
    peer: Option<PairedPort> = Option.None
    failure: Option<Error> = Option.None
    sent: unknown[] = []

    postMessage(message: unknown): void {
        this.sent.push(message)
        const failure = this.failure
        this.failure = Option.None
        if (failure.nonEmpty()) {throw failure.unwrap()}
        this.peer.unwrap().onmessage?.(new MessageEvent("message", {data: structuredClone(message)}))
    }
}

const pair = () => {
    const left = new PairedPort()
    const right = new PairedPort()
    left.peer = Option.wrap(right)
    right.peer = Option.wrap(left)
    return {left, right, sender: Messenger.for(left), receiver: Messenger.for(right)}
}

interface Protocol {
    request(progress: Procedure<number>): Promise<number>
    notify(): void
}

const bind = (dispatcher: Communicator.Dispatcher): Protocol => new class implements Protocol {
    request(progress: Procedure<number>): Promise<number> {
        return dispatcher.dispatchAndReturn(this.request, progress)
    }
    notify(): void {dispatcher.dispatchAndForget(this.notify)}
}

describe("RPC request ownership", () => {
    it("retires a failed send and never reuses its identity or callbacks", async () => {
        const transport = pair()
        const caller = Communicator.sender(transport.sender, bind)
        const failure = new Error("synthetic transport failure")
        const failedProgress = vi.fn()
        transport.left.failure = Option.wrap(failure)
        await expect(caller.request(failedProgress)).rejects.toBe(failure)
        const progress = vi.fn()
        const settled = vi.fn()
        const next = caller.request(progress).then(settled)
        expect(transport.left.sent).toMatchObject([{returnId: 0}, {returnId: 1}])
        expect(() => {
            transport.receiver.send({type: "callback", returnId: 0, funcAt: 0, args: [9]})
            transport.receiver.send({type: "resolve", returnId: 0, resolve: 99})
        }).not.toThrow()
        await Promise.resolve()
        expect(settled).not.toHaveBeenCalled()
        expect(failedProgress).not.toHaveBeenCalled()
        transport.receiver.send({type: "callback", returnId: 1, funcAt: 0, args: [1]})
        transport.receiver.send({type: "resolve", returnId: 1, resolve: 42})
        await next
        expect(progress).toHaveBeenCalledExactlyOnceWith(1)
        expect(settled).toHaveBeenCalledExactlyOnceWith(42)
        transport.sender.terminate()
        transport.receiver.terminate()
    })

    it("reserves identities before a synchronous reentrant send", async () => {
        const transport = pair()
        const caller = Communicator.sender(transport.sender, bind)
        const progress = vi.fn()
        const nested: Promise<number>[] = []
        transport.receiver.subscribe(() => {
            if (transport.left.sent.length === 1) {nested.push(caller.request(progress))}
        })
        const first = caller.request(progress)
        expect(transport.left.sent).toMatchObject([{returnId: 0}, {returnId: 1}])
        transport.receiver.send({type: "resolve", returnId: 1, resolve: 2})
        transport.receiver.send({type: "resolve", returnId: 0, resolve: 1})
        await expect(first).resolves.toBe(1)
        await expect(nested[0]).resolves.toBe(2)
        transport.sender.terminate()
        transport.receiver.terminate()
    })

    it("settles all pending calls on owner termination and ignores late traffic", async () => {
        const transport = pair()
        const owner = new Terminator()
        const caller = Communicator.sender(transport.sender, bind, owner)
        const completion = Promise.withResolvers<number>()
        let remoteProgress: Option<Procedure<number>> = Option.None
        const executor = Communicator.executor<Protocol>(transport.receiver, {
            request: progress => {
                remoteProgress = Option.wrap(progress)
                return completion.promise
            },
            notify: () => {}
        })
        const progress = vi.fn()
        const retired = vi.fn()
        const pending = [caller.request(progress), caller.request(progress)]
        const results = Promise.all(pending.map(promise => promise.catch(reason => {retired(); return reason})))
        owner.terminate()
        owner.terminate()
        await Promise.resolve()
        await Promise.resolve()
        expect(retired).toHaveBeenCalledTimes(2)
        expect(await results).toEqual([expect.objectContaining({message: "Communicator sender terminated"}),
            expect.objectContaining({message: "Communicator sender terminated"})])
        expect(() => remoteProgress.unwrap()(1)).not.toThrow()
        completion.resolve(42)
        await completion.promise
        await Promise.resolve()
        expect(progress).not.toHaveBeenCalled()
        expect(retired).toHaveBeenCalledTimes(2)
        await expect(caller.request(progress)).rejects.toThrow("Communicator sender terminated")
        expect(() => caller.notify()).toThrow("Communicator sender terminated")
        expect(transport.left.sent).toHaveLength(2)
        const unrelated = vi.fn()
        transport.sender.subscribe(unrelated)
        transport.receiver.send({unrelated: true})
        expect(unrelated).toHaveBeenCalledTimes(1)
        executor.terminate()
        transport.sender.terminate()
        transport.receiver.terminate()
    })

    it("releases the sender subscription if protocol binding fails", () => {
        const transport = pair()
        const failure = new Error("binding")
        const cleanupFailure = new Error("unsubscribe")
        const unsubscribe = vi.fn(() => {throw cleanupFailure})
        const subscribe = vi.spyOn(transport.sender, "subscribe").mockReturnValue({terminate: unsubscribe})
        expect(() => Communicator.sender(transport.sender, () => {throw failure})).toThrow(failure)
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        subscribe.mockRestore()
        transport.sender.terminate()
        transport.receiver.terminate()
    })
})
