import {asInstanceOf, isDefined, Maybe, Notifier, Option, SortedSet, Subscription, Terminable, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, BoxVisitor, CaptureAudioBox, CaptureMidiBox} from "@opendaw/studio-boxes"
import {Project} from "../project"
import {Capture} from "./Capture"
import {CaptureMidi} from "./CaptureMidi"
import {CaptureAudio} from "./CaptureAudio"

type CaptureSubscription = { uuid: UUID.Bytes, subscription: Subscription }

export class CaptureDevices implements Terminable {
    readonly #project: Project
    readonly #subscription: Subscription
    readonly #captures: SortedSet<UUID.Bytes, Capture>
    readonly #captureSubscriptions: SortedSet<UUID.Bytes, CaptureSubscription>
    readonly #changeNotifier = new Notifier<void>

    #terminated = false

    constructor(project: Project) {
        this.#project = project
        this.#captures = UUID.newSet<Capture>(({uuid}) => uuid)
        this.#captureSubscriptions = UUID.newSet<CaptureSubscription>(({uuid}) => uuid)
        this.#subscription = this.#project.rootBox.audioUnits.pointerHub.catchupAndSubscribe({
            onAdded: ({box}) => {
                const uuid = box.address.uuid
                const audioUnitBox = asInstanceOf(box, AudioUnitBox)
                const subscription = audioUnitBox.capture.catchupAndSubscribe(pointer => {
                    if (this.#terminated) {return}
                    const removed = this.#captures.removeByKeyIfExist(uuid)
                    removed?.terminate()
                    const capture: Maybe<Capture> = pointer.targetVertex.mapOr(({box}) => box.accept<BoxVisitor<Capture>>({
                        visitCaptureMidiBox: (box: CaptureMidiBox) => new CaptureMidi(this, audioUnitBox, box),
                        visitCaptureAudioBox: (box: CaptureAudioBox) => new CaptureAudio(this, audioUnitBox, box)
                    }), undefined)
                    if (isDefined(capture)) {this.#captures.add(capture)}
                    if (isDefined(removed) || isDefined(capture)) {this.#changeNotifier.notify()}
                })
                this.#captureSubscriptions.add({uuid, subscription})
            },
            onRemoved: ({box: {address: {uuid}}}) => {
                this.#captures.removeByKeyIfExist(uuid)?.terminate()
                this.#captureSubscriptions.removeByKeyIfExist(uuid)?.subscription.terminate()
                this.#changeNotifier.notify()
            }
        })
    }

    get project(): Project {return this.#project}

    get(uuid: UUID.Bytes): Option<Capture> {return this.#captures.opt(uuid)}

    setArm(subject: Capture, exclusive: boolean): void {
        if (this.#project.audioUnitFreeze.isFrozenUuid(subject.audioUnitBox.address.uuid)) {return}
        const arming = !subject.armed.getValue()
        subject.armed.setValue(arming)
        if (arming && exclusive) {
            this.#captures.values()
                .filter(capture => subject !== capture)
                .forEach(capture => capture.armed.setValue(false))
        }
    }

    allCaptures(): ReadonlyArray<Capture> {return this.#captures.values()}
    subscribeChanges(observer: () => void): Subscription {return this.#changeNotifier.subscribe(observer)}

    filterArmed(): ReadonlyArray<Capture> {
        return this.#captures.values()
            .filter(capture => capture.armed.getValue()
                && capture.audioUnitBox.input.pointerHub.nonEmpty()
                && !this.#project.audioUnitFreeze.isFrozenUuid(capture.audioUnitBox.address.uuid))
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#subscription.terminate()
        this.#captureSubscriptions.forEach(({subscription}) => subscription.terminate())
        this.#captureSubscriptions.clear()
        this.#captures.forEach(capture => capture.terminate())
        this.#captures.clear()
    }
}