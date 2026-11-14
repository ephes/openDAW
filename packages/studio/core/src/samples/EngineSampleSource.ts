import {SampleLoader, SampleLoaderManager} from "@opendaw/studio-adapters"
import {AudioData} from "@opendaw/lib-dsp"
import {Procedure, SortedSet, Subscription, Terminable, UUID} from "@opendaw/lib-std"

/** Keeps the engine's one-shot fetches connected to later client invalidations. */
export class EngineSampleSource implements Terminable {
    readonly #watched: SortedSet<UUID.Bytes, {uuid: UUID.Bytes, loader: SampleLoader, subscription: Subscription}>
    readonly #pending: Set<Procedure<void>> = new Set()
    #terminated: boolean = false

    constructor(readonly manager: SampleLoaderManager, readonly invalidate: Procedure<UUID.Bytes>) {
        this.#watched = UUID.newSet(({uuid}) => uuid)
    }

    fetchAudio(uuid: UUID.Bytes): Promise<AudioData> {
        if (this.#terminated) {return Promise.reject(new Error("Sample source terminated"))}
        const loader = this.manager.getOrCreate(uuid)
        const previous = this.#watched.opt(uuid)
        if (previous.isEmpty() || previous.unwrap().loader !== loader) {
            previous.ifSome(entry => {entry.subscription.terminate(); this.#watched.removeByKey(uuid)})
            let settled = loader.state.type === "loaded" || loader.state.type === "error"
            const subscription = loader.subscribe(state => {
                if (state.type === "progress") {
                    if (settled) {settled = false; this.invalidate(uuid)}
                } else {
                    settled = true
                    if (state.type === "error" && state.reason === "Sample load retired") {
                        this.#watched.removeByKeyIfExist(uuid)?.subscription.terminate()
                    }
                }
            })
            this.#watched.add({uuid, loader, subscription})
        }
        const {promise, resolve, reject} = Promise.withResolvers<AudioData>()
        const subscription = loader.subscribe(state => {
            if (state.type === "error") {reject(new Error(state.reason))}
            else if (state.type === "loaded") {resolve(loader.data.unwrap())}
        })
        const retire = () => {subscription.terminate(); reject(new Error("Sample source terminated"))}
        this.#pending.add(retire)
        const cleanup = () => {subscription.terminate(); this.#pending.delete(retire)}
        void promise.then(cleanup, cleanup)
        return promise
    }

    terminate(): void {
        this.#terminated = true
        this.#watched.forEach(entry => entry.subscription.terminate())
        this.#watched.clear()
        this.#pending.forEach(retire => retire())
        this.#pending.clear()
    }
}
