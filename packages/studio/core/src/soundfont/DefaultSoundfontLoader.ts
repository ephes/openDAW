import {Notifier, Observer, Option, Progress, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {SoundfontLoader, SoundfontLoaderState, SoundfontMetaData} from "@opendaw/studio-adapters"
import {GlobalSoundfontLoaderManager} from "./GlobalSoundfontLoaderManager"
import {SoundfontStorage} from "./SoundfontStorage"
import type {SoundFont2} from "soundfont2"
import {ExternalLib} from "../ExternalLib"

export class DefaultSoundfontLoader implements SoundfontLoader {
    readonly #manager: GlobalSoundfontLoaderManager

    readonly #uuid: UUID.Bytes
    readonly #notifier: Notifier<SoundfontLoaderState>

    #generation = 0
    #meta: Option<SoundfontMetaData> = Option.None
    #soundfont: Option<SoundFont2> = Option.None
    #state: SoundfontLoaderState = {type: "progress", progress: 0.0}

    constructor(manager: GlobalSoundfontLoaderManager, uuid: UUID.Bytes) {
        this.#manager = manager
        this.#uuid = uuid

        this.#notifier = new Notifier<SoundfontLoaderState>()
        this.#get()
    }

    subscribe(observer: Observer<SoundfontLoaderState>): Subscription {
        if (this.#state.type === "loaded") {
            observer(this.#state)
            return Terminable.Empty
        }
        const subscription = this.#notifier.subscribe(observer)
        if (this.#state.type === "error") {observer(this.#state)}
        return subscription
    }

    invalidate(): void {this.#get()}

    get uuid(): UUID.Bytes {return this.#uuid}
    get soundfont(): Option<SoundFont2> {return this.#soundfont}
    get meta(): Option<SoundfontMetaData> {return this.#meta}
    get state(): SoundfontLoaderState {return this.#state}

    toString(): string {return `{MainThreadSoundfontLoader}`}

    #setState(value: SoundfontLoaderState): void {
        this.#state = value
        this.#notifier.notify(this.#state)
    }

    #get(): void {
        const generation = ++this.#generation
        this.#meta = Option.None
        this.#soundfont = Option.None
        this.#setState({type: "progress", progress: 0})
        void this.#load(generation).catch((error: unknown) => {
            if (generation !== this.#generation) {return}
            const detail = error instanceof Error ? error.message.slice(0, 200) : "Could not load soundfont"
            const reason = `${detail || "Could not load soundfont"}; retry`
            console.warn("Soundfont loading failed:", reason)
            this.#setState({type: "error", reason})
        })
    }

    async #load(generation: number): Promise<void> {
        if (generation !== this.#generation) {return}
        const cached = await Promises.tryCatch(SoundfontStorage.get().load(this.#uuid))
        if (generation !== this.#generation) {return}
        if (cached.status === "resolved") {
            await this.#publish(cached.value, generation)
            return
        }
        if (cached.error instanceof Error && cached.error.message.startsWith("timeoout")) {throw cached.error}
        const progress: Progress.Handler = value => {
            if (generation === this.#generation) {this.#setState({type: "progress", progress: value})}
        }
        const value = await this.#manager.fetch(this.#uuid, progress)
        if (generation !== this.#generation) {return}
        const [file, meta] = value
        await SoundfontStorage.get().save({uuid: this.#uuid, file, meta})
        if (generation !== this.#generation) {return}
        await this.#publish(value, generation)
    }

    async #publish([file, meta]: [ArrayBuffer, SoundfontMetaData], generation: number): Promise<void> {
        const library = await ExternalLib.SoundFont2()
        if (generation !== this.#generation) {return}
        if (library.status === "rejected") {throw library.error}
        const soundfont = new library.value(new Uint8Array(file))
        if (generation !== this.#generation) {return}
        this.#soundfont = Option.wrap(soundfont)
        this.#meta = Option.wrap(meta)
        this.#setState({type: "loaded"})
    }
}
