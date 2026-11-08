import {DefaultObservableValue, Errors, Notifier, Observer, Option, RuntimeNotifier, Subscription, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import {Promises} from "@opendaw/lib-runtime"
import {AudioUnitBoxAdapter, ExportConfiguration} from "@opendaw/studio-adapters"
import {OfflineEngineRenderer} from "./OfflineEngineRenderer"
import {Address} from "@opendaw/lib-box"

import type {Project} from "./project"

type FrozenEntry = { audioData: AudioData, deletionSubscription: Terminable }

export class AudioUnitFreeze implements Terminable {
    readonly #project: Project
    readonly #terminator = new Terminator()
    readonly #frozenAudioUnits: Map<string, FrozenEntry> = new Map()
    readonly #pending = new Map<string, {generation: number, task: Promise<void>}>()
    readonly #controllers = new Set<AbortController>()
    #terminated = false
    #generation = 0
    readonly #notifier = new Notifier<UUID.Bytes>()

    constructor(project: Project) {
        this.#project = project

        const {timelineBoxAdapter} = project
        this.#terminator.ownAll(
            timelineBoxAdapter.box.bpm.subscribe(() => this.#unfreezeAll()),
            timelineBoxAdapter.catchupAndSubscribeTempoAutomation(() => this.#unfreezeAll())
        )
    }

    isFrozen(audioUnitBoxAdapter: AudioUnitBoxAdapter): boolean {
        return this.#frozenAudioUnits.has(UUID.toString(audioUnitBoxAdapter.uuid))
    }

    isFrozenUuid(uuid: UUID.Bytes): boolean {
        return this.#frozenAudioUnits.has(UUID.toString(uuid))
    }

    subscribe(observer: Observer<UUID.Bytes>): Subscription {return this.#notifier.subscribe(observer)}

    hasSidechainDependents(audioUnitBoxAdapter: AudioUnitBoxAdapter): boolean {
        const targetAddresses: Array<Address> = []
        for (const output of audioUnitBoxAdapter.labeledAudioOutputs()) {
            targetAddresses.push(output.address)
        }
        if (targetAddresses.length === 0) {return false}
        const edges = audioUnitBoxAdapter.box.graph.edges()
        for (const otherUnit of this.#project.rootBoxAdapter.audioUnits.adapters()) {
            if (UUID.equals(otherUnit.uuid, audioUnitBoxAdapter.uuid)) {continue}
            for (const effect of otherUnit.audioEffects.adapters()) {
                for (const [_, target] of edges.outgoingEdgesOf(effect.box)) {
                    if (targetAddresses.some(addr => addr.equals(target))) {
                        return true
                    }
                }
            }
        }
        return false
    }

    freeze(audioUnitBoxAdapter: AudioUnitBoxAdapter): Promise<void> {
        if (this.#terminated) {return Promise.resolve()}
        const key = UUID.toString(audioUnitBoxAdapter.uuid)
        const pending = this.#pending.get(key)
        if (pending?.generation === this.#generation) {return pending.task}
        if (this.isFrozen(audioUnitBoxAdapter)) {return Promise.resolve()}
        const generation = this.#generation
        const abortController = new AbortController()
        this.#controllers.add(abortController)
        // Defer work until the pending owner has been registered.
        const task = Promise.resolve().then(() => this.#freeze(audioUnitBoxAdapter, generation, abortController))
            .finally(() => {
                this.#controllers.delete(abortController)
                if (this.#pending.get(key)?.task === task) {this.#pending.delete(key)}
            })
        this.#pending.set(key, {generation, task})
        return task
    }

    async #freeze(audioUnitBoxAdapter: AudioUnitBoxAdapter, generation: number, abortController: AbortController): Promise<void> {
        if (this.#terminated || abortController.signal.aborted) {return}
        const {engine} = this.#project
        if (this.hasSidechainDependents(audioUnitBoxAdapter)) {
            await RuntimeNotifier.info({
                headline: "Cannot Freeze",
                message: "This audio unit is used as a sidechain source by another device."
            })
            return
        }
        const audioUnitUuid = UUID.toString(audioUnitBoxAdapter.uuid)
        const exportConfiguration: ExportConfiguration = {
            stems: {
                [audioUnitUuid]: {
                    includeAudioEffects: true,
                    includeSends: false,
                    useInstrumentOutput: false,
                    skipChannelStrip: true,
                    fileName: "freeze"
                }
            }
        }
        // Conservatively invalidate on any graph edit: notes, devices, routing and tempo
        // can all affect this render, including dependencies outside the unit.
        let sourceChanged = false
        const sourceSubscription = this.#project.boxGraph.subscribeToAllUpdates({onUpdate: () => {sourceChanged = true}})
        let copiedProject: Project | undefined
        const progress = new DefaultObservableValue(0.0)
        let dialog: ReturnType<typeof RuntimeNotifier.progress> | undefined
        let renderResult: Awaited<ReturnType<typeof Promises.tryCatch<AudioData>>>
        try {
            copiedProject = this.#project.copy()
            dialog = RuntimeNotifier.progress({
                headline: "Freezing AudioUnit...",
                progress,
                cancel: () => abortController.abort()
            })
            renderResult = await Promises.tryCatch(OfflineEngineRenderer.start(
                copiedProject,
                Option.wrap(exportConfiguration),
                progress,
                abortController.signal,
                engine.sampleRate
            ))
        } finally {
            sourceSubscription.terminate()
            try {dialog?.terminate()} finally {copiedProject?.terminate()}
        }
        if (this.#terminated || abortController.signal.aborted) {return}
        if (renderResult.status === "rejected") {
            if (!Errors.isAbort(renderResult.error)) {
                await RuntimeNotifier.info({headline: "Freeze Failed", message: String(renderResult.error)})
            }
            return
        }
        if (generation !== this.#generation) {return}
        if (sourceChanged || !audioUnitBoxAdapter.box.isAttached()) {
            await RuntimeNotifier.info({headline: "Freeze Failed", message: "Source changed while freezing. Please retry with the current project."})
            return
        }
        const audioData = renderResult.value
        const deletionSubscription = audioUnitBoxAdapter.box.subscribeDeletion(() =>
            this.#removeFrozen(audioUnitBoxAdapter.uuid, audioUnitUuid))
        const entry = {audioData, deletionSubscription}
        this.#frozenAudioUnits.set(audioUnitUuid, entry)
        const checkLifetime = () => {
            if (this.#terminated || abortController.signal.aborted) {throw Errors.AbortError}
        }
        let notificationStarted = false
        try {
            checkLifetime()
            engine.setFrozenAudio(audioUnitBoxAdapter.uuid, audioData)
            const {regionSelection, userEditingManager} = this.#project
            const frozenRegions = regionSelection.selected()
                .filter(region => region.trackBoxAdapter
                    .mapOr(track => UUID.equals(track.audioUnit.address.uuid, audioUnitBoxAdapter.uuid), false))
            if (frozenRegions.length > 0) {regionSelection.deselect(...frozenRegions)}
            checkLifetime()
            userEditingManager.timeline.get().ifSome(vertex => {
                const regionUuid = vertex.box.address.uuid
                for (const track of audioUnitBoxAdapter.tracks.values()) {
                    if (track.regions.collection.asArray().some(region => UUID.equals(region.uuid, regionUuid))) {
                        userEditingManager.timeline.clear()
                        break
                    }
                }
            })
            checkLifetime()
            this.#project.captureDevices.get(audioUnitBoxAdapter.uuid)
                .ifSome(capture => capture.armed.setValue(false))
            checkLifetime()
            notificationStarted = true
            this.#notifier.notify(audioUnitBoxAdapter.uuid)
            checkLifetime()
        } catch (error) {
            if (this.#frozenAudioUnits.get(audioUnitUuid) === entry) {
                this.#frozenAudioUnits.delete(audioUnitUuid)
                try {deletionSubscription.terminate()} finally {engine.setFrozenAudio(audioUnitBoxAdapter.uuid, null)}
            }
            if (notificationStarted) {
                try {this.#notifier.notify(audioUnitBoxAdapter.uuid)} catch {console.warn("Freeze rollback notification failed")}
            }
            if (!Errors.isAbort(error)) {throw error}
        }
    }

    unfreeze(audioUnitBoxAdapter: AudioUnitBoxAdapter): void {
        this.#removeFrozen(audioUnitBoxAdapter.uuid, UUID.toString(audioUnitBoxAdapter.uuid))
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#controllers.forEach(controller => controller.abort())
        this.#terminator.terminate()
        for (const [key, entry] of this.#frozenAudioUnits) {
            entry.deletionSubscription.terminate()
            this.#project.engine.setFrozenAudio(UUID.parse(key), null)
        }
        this.#frozenAudioUnits.clear()
    }

    #unfreezeAll(): void {
        this.#generation++
        this.#controllers.forEach(controller => controller.abort())
        const keys = Array.from(this.#frozenAudioUnits.keys())
        for (const key of keys) {
            this.#removeFrozen(UUID.parse(key), key)
        }
    }

    #removeFrozen(uuid: UUID.Bytes, key: string): void {
        const entry = this.#frozenAudioUnits.get(key)
        if (entry === undefined) {return}
        entry.deletionSubscription.terminate()
        this.#project.engine.setFrozenAudio(uuid, null)
        this.#frozenAudioUnits.delete(key)
        this.#notifier.notify(uuid)
    }
}