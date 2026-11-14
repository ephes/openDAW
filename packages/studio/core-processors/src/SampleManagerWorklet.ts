import {Peaks} from "@opendaw/lib-fusion"
import {EngineToClient, SampleLoader, SampleLoaderManager, SampleLoaderState} from "@opendaw/studio-adapters"
import {Notifier, Observer, Option, SortedSet, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"

class SampleLoaderWorklet implements SampleLoader, Terminable {
    readonly peaks: Option<Peaks> = Option.None
    readonly #notifier = new Notifier<SampleLoaderState>()
    #state: SampleLoaderState = {type: "idle"}

    #data: Option<AudioData> = Option.None
    #retired: boolean = false
    #attempt: number = 0

    constructor(readonly uuid: UUID.Bytes, readonly engineToClient: EngineToClient) {
        this.invalidate()
    }

    get data(): Option<AudioData> {return this.#data}
    get state(): SampleLoaderState {return this.#state}

    subscribe(observer: Observer<SampleLoaderState>): Subscription {
        observer(this.#state)
        return this.#notifier.subscribe(observer)
    }
    invalidate(): void {
        if (this.#retired) {return}
        const attempt = ++this.#attempt
        this.#data = Option.None
        this.#state = {type: "progress", progress: 0}
        this.#notifier.notify(this.#state)
        this.engineToClient.fetchAudio(this.uuid).then(data => {
            if (this.#retired || attempt !== this.#attempt) {return}
            this.#data = Option.wrap(data)
            this.#state = {type: "loaded"}
            this.#notifier.notify(this.#state)
        }, error => {
            if (this.#retired || attempt !== this.#attempt) {return}
            this.#state = {type: "error", reason: error instanceof Error ? error.message : String(error)}
            this.#notifier.notify(this.#state)
        })
    }
    terminate(): void {
        this.#retired = true
        this.#data = Option.None
        this.#state = {type: "idle"}
        this.#notifier.terminate()
    }

    toString(): string {return `{SampleLoaderWorklet}`}
}

export class SampleManagerWorklet implements SampleLoaderManager, Terminable {
    readonly #engineToClient: EngineToClient
    readonly #set: SortedSet<UUID.Bytes, SampleLoaderWorklet>
    #terminated: boolean = false

    constructor(engineToClient: EngineToClient) {
        this.#engineToClient = engineToClient
        this.#set = UUID.newSet<SampleLoaderWorklet>(({uuid}) => uuid)
    }

    record(_loader: SampleLoader): void {}
    getOrCreate(uuid: UUID.Bytes): SampleLoader {
        if (this.#terminated) {throw new Error("Sample manager terminated")}
        return this.#set.getOrCreate(uuid, uuid => new SampleLoaderWorklet(uuid, this.#engineToClient))
    }
    remove(uuid: UUID.Bytes): void {this.#set.removeByKeyIfExist(uuid)?.terminate()}
    register(_uuid: UUID.Bytes): Terminable {return Terminable.Empty}
    invalidate(uuid: UUID.Bytes): void {this.#set.opt(uuid).ifSome(loader => loader.invalidate())}
    terminate(): void {
        this.#terminated = true
        this.#set.forEach(loader => loader.terminate())
        this.#set.clear()
    }
}
