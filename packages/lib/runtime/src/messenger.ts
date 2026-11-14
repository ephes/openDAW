import {
    isDefined,
    Notifier,
    Nullable,
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
    readonly #onmessage: Procedure<MessageEvent>
    readonly #onmessageerror: Procedure<MessageEvent>
    #terminated = false

    constructor(port: Port) {
        this.#port = port

        if (isDefined(port.onmessage) || isDefined(port.onmessageerror)) {
            console.error(port)
            throw new Error(`${port} is already wrapped.`)
        }
        this.#onmessage = (event: MessageEvent) => {
            if (!this.#terminated) {this.#notifier.notify(event.data)}
        }
        this.#onmessageerror = (event: MessageEvent) => {
            if (!this.#terminated) {throw new Error(event.type)}
        }
        port.onmessage = this.#onmessage
        port.onmessageerror = this.#onmessageerror
    }

    send(message: unknown, transfer?: Array<Transferable>): void {
        if (this.#terminated) {return}
        this.#port.postMessage(message, transfer ?? EmptyTransferables)
    }

    channel(name: string): Messenger {return new Channel(this, name)}
    subscribe<T>(observer: Observer<T>): Subscription {
        return this.#terminated ? Terminable.Empty : this.#notifier.subscribe(observer as Observer<unknown>)
    }
    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#notifier.terminate()
        if (this.#port.onmessage === this.#onmessage) {this.#port.onmessage = null}
        if (this.#port.onmessageerror === this.#onmessageerror) {this.#port.onmessageerror = null}
    }
}

// with '__id__' we put in a little security that we are only communicating with the messenger we created
class Channel implements Messenger {
    readonly #messages: Messenger
    readonly #name: string
    readonly #notifier = new Notifier<unknown>()
    readonly #subscription: Subscription
    #terminated = false

    constructor(messages: Messenger, name: string) {
        this.#messages = messages
        this.#name = name
        this.#subscription = messages.subscribe<{__id__?: string, message?: unknown, channel?: string}>(data => {
            if ("__id__" in data && data.__id__ === "42" && "message" in data && "channel" in data && data.channel === name) {
                this.#notifier.notify(data.message)
            }
        })
    }

    send(message: unknown, transferrables?: Array<Transferable>): void {
        if (this.#terminated) {return}
        this.#messages.send({__id__: "42", channel: this.#name, message}, transferrables)
    }

    channel(name: string): Messenger {return new Channel(this, name)}
    subscribe<T>(observer: Observer<T>): Subscription {
        return this.#terminated ? Terminable.Empty : this.#notifier.subscribe(observer as Observer<unknown>)
    }
    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#subscription.terminate()
        this.#notifier.terminate()
    }
}
