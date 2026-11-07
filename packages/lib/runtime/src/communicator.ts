import {int, isDefined, Iterables, Maybe, panic, Subscription, Terminable} from "@opendaw/lib-std"
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

    export const sender = <PROTOCOL>(messenger: Messenger, bind: (dispatcher: Dispatcher) => PROTOCOL): PROTOCOL =>
        bind(new Sender(messenger))

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

        constructor(messenger: Messenger) {
            this.#messenger = messenger
            this.#subscription = messenger.subscribe(this.#messageHandler)
        }

        terminate(): void {this.#subscription.terminate()}

        readonly dispatchAndForget = <F extends (..._: Parameters<F>) => void>
        (func: F, ...args: Parameters<F>): void => {
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
            const entries = Iterables.reduce(args, (callbacks: [int, ((...args: unknown[]) => unknown)][], arg: unknown, index: int) => {
                if (typeof arg === "function") {callbacks.push([index, arg as (...args: unknown[]) => unknown])}
                return callbacks
            }, [])
            this.#expected.set(this.#returnId, {
                executorTuple: {resolve, reject},
                callbacks: new Map<int, ((...args: unknown[]) => unknown)>(entries)
            })
            const transferables = extractTransferables(args)
            this.#messenger.send({
                type: "send",
                returnId: this.#returnId,
                func: func.name as keyof PROTOCOL,
                args: Array.from(Iterables.map(args, (arg, index) =>
                    typeof arg === "function" ? ({callback: index}) : ({value: unwrapArg(arg)})))
            } satisfies Send<PROTOCOL>, transferables)
            this.#returnId++
        })

        readonly #messageHandler = (message: Resolve | Reject | Callback) => {
            const returns: Maybe<Return> = this.#expected.get(message.returnId)
            if (isDefined(returns)) {
                if (message.type === "resolve") {
                    returns.executorTuple.resolve(message.resolve as never)
                    this.#expected.delete(message.returnId)
                } else if (message.type === "reject") {
                    returns.executorTuple.reject(message.reject)
                    this.#expected.delete(message.returnId)
                } else if (message.type === "callback") {
                    returns.callbacks?.get(message.funcAt)!.apply(this, message.args)
                }
            } else {
                panic(`Promise has already been resolved. ${JSON.stringify(message)}`)
            }
        }
    }

    export class Executor<PROTOCOL> implements Terminable {
        readonly #messenger: Messenger
        readonly #protocol: PROTOCOL
        readonly #methods = new Map<string, (...args: unknown[]) => unknown>()
        readonly #subscription: Subscription

        constructor(messenger: Messenger, protocol: PROTOCOL) {
            this.#messenger = messenger
            this.#protocol = protocol
            // Public surface: own data methods and immediate class-prototype
            // methods, excluding Object's ambient methods and all accessors.
            const reserved = new Set(Object.getOwnPropertyNames(Object.prototype))
            for (const object of [Object.getPrototypeOf(protocol), protocol]) {
                if (object === null || object === Object.prototype) {continue}
                for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
                    if (!reserved.has(name) && typeof descriptor.value === "function") {
                        this.#methods.set(name, descriptor.value)
                    }
                }
            }
            this.#subscription = messenger.subscribe(this.#messageHandler)
        }

        terminate(): void {this.#subscription.terminate()}

        readonly #messageHandler = (message: unknown) => {
            if (message === null || typeof message !== "object" || Array.isArray(message)) {return}
            const request = message as Record<string, unknown>
            const returnId = request.returnId
            const reply = typeof returnId === "number" && Number.isSafeInteger(returnId) && returnId >= 0
            if (returnId !== false && !reply) {return}
            try {
                if (request.type !== "send") {throw new Error("Invalid RPC request type")}
                if (typeof request.func !== "string") {throw new Error("Invalid RPC method")}
                const func = this.#methods.get(request.func)
                if (func === undefined) {throw new Error("Unknown protocol method")}
                if (!Array.isArray(request.args)) {throw new Error("Invalid RPC arguments")}
                const args = request.args.map((arg: unknown) => {
                    if (arg === null || typeof arg !== "object" || Array.isArray(arg)) {throw new Error("Invalid RPC argument")}
                    const item = arg as Record<string, unknown>
                    if (Object.hasOwn(item, "value") && !Object.hasOwn(item, "callback")) {return item.value}
                    if (!reply || !Object.hasOwn(item, "callback") || Object.hasOwn(item, "value")
                        || typeof item.callback !== "number" || !Number.isSafeInteger(item.callback) || item.callback < 0) {
                        throw new Error("Invalid RPC callback")
                    }
                    const callback = item.callback
                    return (...values: unknown[]) => this.#sendCallback(returnId as number, callback, values)
                })
                const result = func.apply(this.#protocol, args)
                if (reply) {
                    Promise.resolve(result).then(value => {
                        try {this.#sendResolve(returnId, value)} catch (reason) {this.#sendReject(returnId, reason)}
                    }, reason => this.#sendReject(returnId, reason))
                }
            } catch (reason) {
                if (reply) {this.#sendReject(returnId, reason)}
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