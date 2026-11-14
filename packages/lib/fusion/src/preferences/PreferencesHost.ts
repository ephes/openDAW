import {
    MutableObservableValue,
    Observer,
    PathTuple,
    Subscription,
    Terminable,
    Terminator,
    tryCatch,
    ValueAtPath,
    VirtualObject
} from "@opendaw/lib-std"
import {queueTask} from "@opendaw/lib-dom"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import {Preferences} from "./Preferences"
import {PreferencesProtocol} from "./PreferencesProtocol"

export class PreferencesHost<SETTINGS extends object> implements Preferences<SETTINGS>, Terminable {
    readonly #terminator = new Terminator()
    readonly #object: VirtualObject<SETTINGS>
    #terminated = false

    constructor(settings: SETTINGS) {this.#object = this.#terminator.own(new VirtualObject(settings))}

    get settings(): SETTINGS {return this.#object.proxy}

    syncWith(messenger: Messenger): Subscription {
        if (this.#terminated) {return Terminable.Empty}
        const owner = this.#terminator.spawn()
        let active = true
        const result = tryCatch(() => {
            const client = Communicator.sender<PreferencesProtocol<SETTINGS>>(messenger,
                ({dispatchAndForget}) => new class implements PreferencesProtocol<SETTINGS> {
                    updateSettings(preferences: SETTINGS): void {
                        dispatchAndForget(this.updateSettings, preferences)
                    }
                }, owner)
            const queue = queueTask(() => {if (active && !this.#terminated) {client.updateSettings(this.#object.data)}})
            owner.own(this.#object.subscribeAll(queue))
            owner.own({terminate: () => {active = false}})
            if (!this.#terminated) {client.updateSettings(this.#object.data)} else {owner.terminate()}
        })
        if (result.status === "failure") {
            active = false
            tryCatch(() => owner.terminate())
            throw result.error
        }
        return owner
    }

    update(data: SETTINGS): void {this.#object.update(data)}

    subscribe<P extends PathTuple<SETTINGS>>(
        observer: Observer<ValueAtPath<SETTINGS, P>>, ...path: P): Subscription {
        return this.#object.subscribe(observer, ...path)
    }

    catchupAndSubscribe<P extends PathTuple<SETTINGS>>(
        observer: Observer<ValueAtPath<SETTINGS, P>>, ...path: P): Subscription {
        return this.#object.catchupAndSubscribe(observer, ...path)
    }

    createMutableObservableValue<P extends PathTuple<SETTINGS>>(...path: P): MutableObservableValue<ValueAtPath<SETTINGS, P>> & Terminable {
        return this.#object.createMutableObservableValue(...path)
    }

    subscribeAll(observer: Observer<keyof SETTINGS>): Subscription {
        return this.#object.subscribeAll(observer)
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#terminator.terminate()
    }
}
