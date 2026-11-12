import {
    asDefined,
    asInstanceOf,
    Errors,
    int,
    isNotNull,
    Nullable,
    Option,
    Procedure,
    RuntimeNotifier,
    SortedSet,
    Subscription,
    Terminable,
    Terminator,
    UUID
} from "@opendaw/lib-std"
import {Address, Field, Int32Field, PrimitiveField, PrimitiveValues, StringField} from "@opendaw/lib-box"
import {MidiData} from "@opendaw/lib-midi"
import {Pointers} from "@opendaw/studio-enums"
import {Project} from "../project"
import {MidiDevices} from "./MidiDevices"
import {AnimationFrame} from "@opendaw/lib-dom"
import {MIDIControllerBox} from "@opendaw/studio-boxes"

interface MIDIRoute {
    handleEvent: Procedure<MIDIMessageEvent>
    subscription: Subscription
}

interface MIDIConnection extends MIDIRoute {
    box: MIDIControllerBox
}

// will be part of MIDI preferences. Should not filter for the device-id
// because it is different for the same hardware in different browsers.
const respectDeviceID = false

export class MIDILearning implements Terminable {
    readonly #terminator = new Terminator()

    readonly #project: Project
    readonly #connections: SortedSet<Address, MIDIConnection>

    #optMIDIContollers: Option<Field<Pointers.MIDIControllers>> = Option.None
    #optFieldSubscription: Option<Subscription> = Option.None
    #optLearnLifecycle: Option<Terminable> = Option.None
    #terminated = false
    #generation = 0
    #learnAttempt = 0

    constructor(project: Project) {
        this.#project = project
        this.#connections = Address.newSet<MIDIConnection>(connection => connection.box.address)
    }

    followUser(field: Field<Pointers.MIDIControllers>): void {
        if (this.#terminated) {return}
        this.#generation++
        this.#killAllConnections()
        this.#optFieldSubscription.ifSome(subscription => subscription.terminate())
        this.#optFieldSubscription = Option.None
        this.#optMIDIContollers = Option.wrap(field)
        this.#optFieldSubscription = Option.wrap(field.pointerHub.catchupAndSubscribe({
            onAdded: ({box: anyBox}) => {
                if (this.#terminated) {return}
                const box = asInstanceOf(anyBox, MIDIControllerBox)
                const {subscription, handleEvent} = this.#registerMIDIControllerBox(box)
                this.#connections.add({box, subscription, handleEvent})
            },
            onRemoved: ({box: {address}}) => this.#connections.removeByKey(address).subscription.terminate()
        }))
    }

    hasMidiConnection(address: Address): boolean {
        return this.#findConnectionByParameterAddress(address).nonEmpty()
    }

    forgetMidiConnection(address: Address) {
        const connection = this.#findConnectionByParameterAddress(address).unwrap("No connection to forget")
        this.#project.editing.modify(() => asDefined(connection).box.delete())
    }

    async learnMIDIControls(field: PrimitiveField<PrimitiveValues, Pointers.MIDIControl | Pointers>) {
        if (this.#terminated || !field.isAttached()) {return}
        if (this.#optMIDIContollers.isEmpty()) {
            return RuntimeNotifier.info({
                headline: "Learn Midi Controller...",
                message: "No user accepting midi controls."
            })
        }
        if (!MidiDevices.canRequestMidiAccess()) {return}
        const owner = this.#optMIDIContollers.unwrap()
        const generation = this.#generation
        const attempt = ++this.#learnAttempt
        this.#retireLearning()
        const isCurrent = () => !this.#terminated && generation === this.#generation
            && attempt === this.#learnAttempt && owner.isAttached() && field.isAttached()
        await MidiDevices.requestPermission()
        if (!isCurrent()) {return}
        const learnLifecycle = this.#terminator.spawn()
        this.#optLearnLifecycle = Option.wrap(learnLifecycle)
        const abortController = new AbortController()
        learnLifecycle.own({terminate: () => abortController.abort(Errors.AbortError)})
        learnLifecycle.own(MidiDevices.subscribeMessageEvents((event: MIDIMessageEvent) => {
            if (!isCurrent()) {
                learnLifecycle.terminate()
                return
            }
            const data = event.data
            if (data === null) {return}
            const deviceId = event.target instanceof MIDIInput ? event.target.id : ""
            if (MidiData.isController(data)) {
                learnLifecycle.terminate()
                const {editing} = this.#project
                const optBox = editing.modify(() => MIDIControllerBox.create(this.#project.boxGraph, UUID.generate(), box => {
                    box.controllers.refer(owner)
                    box.parameter.refer(field)
                    box.deviceId.setValue(deviceId)
                    box.deviceChannel.setValue(MidiData.readChannel(data))
                    box.controlId.setValue(MidiData.readParam1(data))
                }))
                this.#connections.get(optBox.unwrap("Could not create MIDIControllerBox").address).handleEvent(event)
            }
        }))
        return RuntimeNotifier.info({
            headline: "Learn Midi Controller...",
            message: "Turn a controller on your midi-device...",
            okText: "Cancel",
            abortSignal: abortController.signal
        }).then(() => learnLifecycle.terminate(), Errors.CatchAbort)
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#generation++
        this.#optFieldSubscription.ifSome(subscription => subscription.terminate())
        this.#optFieldSubscription = Option.None
        this.#optMIDIContollers = Option.None
        this.#killAllConnections()
        this.#terminator.terminate()
    }

    #registerMIDIControllerBox({parameter, deviceChannel, controlId, deviceId}: MIDIControllerBox): MIDIRoute {
        let retired = false
        let optRoute: Option<MIDIRoute> = Option.None
        const connect = () => {
            optRoute.ifSome(route => route.subscription.terminate())
            optRoute = Option.None
            if (retired) {return}
            optRoute = parameter.targetAddress.map(address =>
                this.#routeMIDIControl(address, deviceChannel.getValue(), controlId, deviceId))
        }
        connect()
        const parameterSubscription = parameter.subscribe(connect)
        const channelSubscription = deviceChannel.subscribe(connect)
        return {
            subscription: {
                terminate: () => {
                    retired = true
                    parameterSubscription.terminate()
                    channelSubscription.terminate()
                    connect()
                }
            },
            handleEvent: (event: MIDIMessageEvent) => optRoute.ifSome(route => route.handleEvent(event))
        }
    }

    #routeMIDIControl(address: Address, deviceChannel: int, controlId: Int32Field, deviceId: StringField): MIDIRoute {
        const adapter = this.#project.parameterFieldAdapters.get(address)
        const {editing} = this.#project
        const registration = adapter.registerMidiControl()
        let pendingValue: Nullable<number> = null
        const update = (value: number) => editing.modify(() => adapter.setUnitValue(value), false)
        const handleEvent = (event: MIDIMessageEvent) => {
            const data = event.data
            if (data === null) {return}
            const id = event.target instanceof MIDIInput ? event.target.id : ""
            if (MidiData.isController(data)
                && MidiData.readParam1(data) === controlId.getValue() && (!respectDeviceID || id === deviceId.getValue())) {
                const value = MidiData.asValue(data)
                if (pendingValue === null) {
                    update(value)
                    pendingValue = value
                    AnimationFrame.once(() => {
                        if (isNotNull(pendingValue)) {
                            update(pendingValue)
                            pendingValue = null
                        }
                    })
                } else {
                    pendingValue = value
                }
            }
        }
        const channel = deviceChannel === -1 ? undefined : deviceChannel
        const subscription = MidiDevices.subscribeMessageEvents(handleEvent, channel)
        return {
            subscription: {
                terminate: () => {
                    pendingValue = null
                    subscription.terminate()
                    registration.terminate()
                }
            }, handleEvent
        }
    }

    #retireLearning(): void {
        this.#optLearnLifecycle.ifSome(lifecycle => lifecycle.terminate())
        this.#optLearnLifecycle = Option.None
    }

    #killAllConnections(): void {
        this.#connections.forEach(({subscription}) => subscription.terminate())
        this.#connections.clear()
    }

    #findConnectionByParameterAddress(address: Address): Option<MIDIConnection> {
        return Option.wrap(this.#connections.values().find(({box}) => box.parameter.targetAddress.unwrap() === address))
    }
}
