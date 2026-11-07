import {
    isDefined,
    Notifier,
    Nullable,
    Observable,
    Observer,
    Procedure,
    Subscription,
    Terminable
} from "@opendaw/lib-std"

export type Port = {
    postMessage(message: unknown, transfer?: Array<Transferable>): void
    onmessage: Nullable<Procedure<MessageEvent>>
    onmessageerror: Nullable<Procedure<MessageEvent>>
}

export const Messenger = {for: (port: Port): Messenger => new NativeMessenger(port)}

export type Messenger = Terminable & {
    subscribe<T>(observer: Observer<T>): Subscription
    send(message: unknown, transfer?: Array<Transferable>): void
    channel(name: string): Messenger
}

const EmptyTransferables: Array<Transferable> = []

class NativeMessenger implements Messenger {
    readonly #port: Port
    readonly #notifier = new Notifier<unknown>()

    constructor(port: Port) {
        this.#port = port

        if (isDefined(port.onmessage) || isDefined(port.onmessageerror)) {
            console.error(port)
            throw new Error(`${port} is already wrapped.`)
        }
        port.onmessage = (event: MessageEvent) => this.#notifier.notify(event.data)
        port.onmessageerror = (event: MessageEvent) => {throw new Error(event.type)}
    }

    send(message: unknown, transfer?: Array<Transferable>): void {
        this.#port.postMessage(message, transfer ?? EmptyTransferables)
    }

    channel(name: string): Messenger {return new Channel(this, name)}
    subscribe<T>(observer: Observer<T>): Subscription {return this.#notifier.subscribe(observer as Observer<unknown>)}
    terminate(): void {
        this.#notifier.terminate()
        this.#port.onmessage = null
        this.#port.onmessageerror = null
    }
}

// with '__id__' we put in a little security that we are only communicating with the messenger we created
class Channel implements Messenger {
    readonly #messages: Messenger
    readonly #name: string
    readonly #notifier = new Notifier<unknown>()
    readonly #subscription: Subscription

    constructor(messages: Messenger, name: string) {
        this.#messages = messages
        this.#name = name
        this.#subscription = messages.subscribe<unknown>(data => {
            if (data === null || typeof data !== "object" || Array.isArray(data)) {return}
            const envelope = data as Record<string, unknown>
            if (Object.hasOwn(envelope, "__id__") && envelope.__id__ === "42"
                && Object.hasOwn(envelope, "message") && Object.hasOwn(envelope, "channel")
                && typeof envelope.channel === "string" && envelope.channel === name) {
                this.#notifier.notify(envelope.message)
            }
        })
    }

    send(message: unknown, transferrables?: Array<Transferable>): void {
        this.#messages.send({__id__: "42", channel: this.#name, message}, transferrables)
    }

    channel(name: string): Messenger {return new Channel(this, name)}
    subscribe<T>(observer: Observer<T>): Subscription {return this.#notifier.subscribe(observer as Observer<unknown>)}
    terminate(): void {
        this.#subscription.terminate()
        this.#notifier.terminate()
    }
}