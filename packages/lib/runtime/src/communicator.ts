import {
    asDefined, assert, int, isDefined, Iterables, Maybe, panic, Subscription, Terminable, TerminableOwner, tryCatch
} from "@opendaw/lib-std"
import {Messenger} from "./messenger"
import {ExecutorTuple} from "./promises"

/**
 * Communicator provides type-safe communication between Window, Worker, MessagePort, BroadcastChannel.
 * Passed objects are structured cloned: https://developer.mozilla.org/en-US/docs/Web/API/structuredClone
 * It is highly advised not to pass classes with methods and or real private properties (starting with #).
 * They will lose their prototype and private property inheritance, and it is cumbersome to patch that up later.
 * Also read: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain
 */
export namespace Communicator {
    export class Transfer<T extends Transferable> {
        constructor(readonly value: T) {}
    }

    export const makeTransferable = <T extends Transferable>(value: T): T => new Transfer(value) as unknown as T

    export const sender = <PROTOCOL>(messenger: Messenger, bind: (dispatcher: Dispatcher) => PROTOCOL,
                                     owner?: TerminableOwner): PROTOCOL => {
        const sender = new Sender(messenger)
        const result = tryCatch(() => {
            owner?.own(sender)
            return bind(sender)
        })
        if (result.status === "failure") {
            tryCatch(() => sender.terminate())
            throw result.error
        }
        return result.value
    }

    export const executor = <PROTOCOL>(messenger: Messenger, protocol: PROTOCOL): Executor<PROTOCOL> =>
        new Executor(messenger, protocol)

    export interface Dispatcher {
        dispatchAndForget: <F extends (..._: Parameters<F>) => void>(func: F, ...args: Parameters<F>) => void
        dispatchAndReturn: <F extends (..._: Parameters<F>) => Promise<R>, R>(func: F, ...args: Parameters<F>) => Promise<R>
    }

    const extractTransferables = (args: unknown[]): Transferable[] => {
        const transferables: Transferable[] = []
        for (const arg of args) {
            if (arg instanceof Transfer) {
                transferables.push(arg.value)
            } else if (arg instanceof MessagePort) {
                transferables.push(arg)
            } else if (typeof ImageBitmap !== "undefined" && arg instanceof ImageBitmap) {
                transferables.push(arg)
            } else if (typeof OffscreenCanvas !== "undefined" && arg instanceof OffscreenCanvas) {
                transferables.push(arg)
            }
        }
        return transferables
    }

    const unwrapArg = (arg: unknown): unknown => arg instanceof Transfer ? arg.value : arg

    class Sender<PROTOCOL> implements Dispatcher, Terminable {
        readonly #messenger: Messenger
        readonly #expected = new Map<int, Return>()
        readonly #subscription: Subscription

        #returnId: int = 0
        #terminated: boolean = false

        constructor(messenger: Messenger) {
            this.#messenger = messenger
            this.#subscription = messenger.subscribe(this.#messageHandler)
        }

        terminate(): void {
            if (this.#terminated) {return}
            this.#terminated = true
            const pending = Array.from(this.#expected.values())
            this.#expected.clear()
            for (const returns of pending) {returns.executorTuple.reject(new Error("Communicator sender terminated"))}
            this.#subscription.terminate()
        }

        readonly dispatchAndForget = <F extends (..._: Parameters<F>) => void>
        (func: F, ...args: Parameters<F>): void => {
            if (this.#terminated) {throw new Error("Communicator sender terminated")}
            const transferables = extractTransferables(args)
            this.#messenger.send({
                type: "send",
                returnId: false,
                func: func.name as keyof PROTOCOL,
                args: Array.from(Iterables.map(args, arg => ({value: unwrapArg(arg)})))
            } satisfies Send<PROTOCOL>, transferables)
        }

        readonly dispatchAndReturn = <F extends (..._: Parameters<F>) => Promise<R>, R>
        (func: F, ...args: Parameters<F>): Promise<R> => new Promise<R>((resolve, reject) => {
            if (this.#terminated) {reject(new Error("Communicator sender terminated")); return}
            const returnId = this.#returnId++
            const entries = Iterables.reduce(args, (callbacks: [int, ((...args: unknown[]) => unknown)][], arg: unknown, index: int) => {
                if (typeof arg === "function") {callbacks.push([index, arg as (...args: unknown[]) => unknown])}
                return callbacks
            }, [])
            const returns: Return = {
                executorTuple: {resolve, reject},
                callbacks: new Map<int, ((...args: unknown[]) => unknown)>(entries)
            }
            this.#expected.set(returnId, returns)
            const result = tryCatch(() => {
                const transferables = extractTransferables(args)
                this.#messenger.send({
                    type: "send",
                    returnId,
                    func: func.name as keyof PROTOCOL,
                    args: Array.from(Iterables.map(args, (arg, index) =>
                        typeof arg === "function" ? ({callback: index}) : ({value: unwrapArg(arg)})))
                } satisfies Send<PROTOCOL>, transferables)
            })
            if (result.status === "failure") {
                if (this.#expected.get(returnId) === returns) {this.#expected.delete(returnId)}
                reject(result.error)
            }
        })

        readonly #messageHandler = (message: Resolve | Reject | Callback) => {
            const returns: Maybe<Return> = this.#expected.get(message.returnId)
            if (isDefined(returns)) {
                if (message.type === "resolve") {
                    this.#expected.delete(message.returnId)
                    returns.executorTuple.resolve(message.resolve as never)
                } else if (message.type === "reject") {
                    this.#expected.delete(message.returnId)
                    returns.executorTuple.reject(message.reject)
                } else if (message.type === "callback") {
                    returns.callbacks?.get(message.funcAt)!.apply(this, message.args)
                }
            }
        }
    }

    export class Executor<PROTOCOL> implements Terminable {
        readonly #messenger: Messenger
        readonly #protocol: PROTOCOL
        readonly #subscription: Subscription

        constructor(messenger: Messenger, protocol: PROTOCOL) {
            this.#messenger = messenger
            this.#protocol = protocol
            this.#subscription = messenger.subscribe(this.#messageHandler)
        }

        terminate(): void {this.#subscription.terminate()}

        readonly #messageHandler = (message: Send<PROTOCOL>) => {
            assert(message.type === "send", () => "Message type must be 'send'")
            const object = Object.getPrototypeOf(this.#protocol) === Object.getPrototypeOf({})
                ? this.#protocol : Object.getPrototypeOf(this.#protocol)
            const func = asDefined(
                object[message.func] as (...args: unknown[]) => Promise<unknown>,
                `${message.func.toString()} does not exists on ${this.#protocol}`)
            const returnId: number | false = message.returnId
            if (returnId === false) {
                func.apply(this.#protocol, message.args.map((arg: Arg) => "value" in arg
                    ? arg.value : panic(`${message.func.toString()} has no promise.`)))
            } else {
                try {
                    const promise: Promise<unknown> = func.apply(this.#protocol, message.args
                        .map(arg => "callback" in arg ? (...args: unknown[]) =>
                            this.#sendCallback(returnId, arg.callback, args) : arg.value))
                    promise.then(value => {
                            try {
                                this.#sendResolve(returnId, value)
                            } catch (reason) {
                                this.#sendReject(returnId, reason)
                            }
                        },
                        reason => this.#sendReject(returnId, reason))
                } catch (reason) {this.#sendReject(returnId, reason)}
            }
        }

        readonly #sendResolve = (returnId: number, value: unknown): void =>
            this.#messenger.send({type: "resolve", returnId, resolve: value} satisfies Resolve)

        readonly #sendReject = (returnId: number, reason: unknown): void =>
            this.#messenger.send({type: "reject", returnId, reject: reason} satisfies Reject)

        readonly #sendCallback = (returnId: number, func: int, args: unknown[]): void =>
            this.#messenger.send({type: "callback", returnId, funcAt: func, args})
    }

    type Send<T> = {
        type: "send"
        func: keyof T
        args: Arg[]
        returnId: int | false
    }

    type Callback = {
        type: "callback"
        funcAt: int
        args: Arg[]
        returnId: int
    }

    type Resolve = {
        type: "resolve"
        resolve: unknown
        returnId: int
    }

    type Reject = {
        type: "reject"
        reject: unknown
        returnId: int
    }

    type Return = {
        executorTuple: ExecutorTuple<never>
        callbacks?: Map<int, ((...args: unknown[]) => unknown)>
    }

    type Arg = { value: unknown } | { callback: int }
}
