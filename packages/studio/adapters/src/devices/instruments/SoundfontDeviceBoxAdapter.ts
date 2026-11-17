import {
    int,
    MutableObservableOption,
    ObservableOption,
    Option,
    Subscription,
    Terminable,
    Terminator,
    UUID
} from "@opendaw/lib-std"
import {SoundfontDeviceBox} from "@opendaw/studio-boxes"
import {Address, BooleanField, StringField} from "@opendaw/lib-box"
import {DeviceHost, Devices, InstrumentDeviceBoxAdapter} from "../../DeviceAdapter"
import {LabeledAudioOutput} from "../../LabeledAudioOutputsOwner"
import {BoxAdaptersContext} from "../../BoxAdaptersContext"
import {DeviceManualUrls} from "../../DeviceManualUrls"
import {ParameterAdapterSet} from "../../ParameterAdapterSet"
import {TrackType} from "../../timeline/TrackType"
import {AudioUnitBoxAdapter} from "../../audio-unit/AudioUnitBoxAdapter"
import {SoundfontLoader} from "../../soundfont/SoundfontLoader"
import type {Preset, SoundFont2} from "soundfont2"

export class SoundfontDeviceBoxAdapter implements InstrumentDeviceBoxAdapter {
    readonly type = "instrument"
    readonly accepts = "midi"
    readonly manualUrl = DeviceManualUrls.Soundfont

    readonly #terminator = new Terminator()

    readonly #context: BoxAdaptersContext
    readonly #box: SoundfontDeviceBox

    readonly #parametric: ParameterAdapterSet
    readonly namedParameter // let typescript infer the type

    readonly #loader: MutableObservableOption<SoundfontLoader>
    readonly #soundfont: MutableObservableOption<SoundFont2>
    readonly #preset: MutableObservableOption<Preset>

    #loaderSubscription: Subscription = Terminable.Empty
    #loaderGeneration: number = 0
    #terminated: boolean = false

    constructor(context: BoxAdaptersContext, box: SoundfontDeviceBox) {
        this.#context = context
        this.#box = box
        this.#parametric = new ParameterAdapterSet(this.#context)
        this.namedParameter = this.#wrapParameters(box)

        this.#loader = new MutableObservableOption<SoundfontLoader>()
        this.#soundfont = new MutableObservableOption<SoundFont2>()
        this.#preset = new MutableObservableOption<Preset>()

        this.#terminator.ownAll(
            this.#loader.subscribe(this.#loaderObserver),
            this.#box.file.catchupAndSubscribe(({targetVertex}) =>
                this.#loader.wrapOption(targetVertex.map(({box}) =>
                    context.soundfontManager.getOrCreate(box.address.uuid)))),
            this.#box.presetIndex.catchupAndSubscribe(owner => this.#soundfont.match({
                none: () => this.#preset.clear(),
                some: soundfont => this.#preset.wrap(soundfont.presets[owner.getValue()] ?? soundfont.presets[0])
            }))
        )
    }
    get loader(): ObservableOption<SoundfontLoader> {return this.#loader}
    get soundfont(): ObservableOption<SoundFont2> {return this.#soundfont}
    get preset(): ObservableOption<Preset> {return this.#preset}
    get presetIndex(): int {return this.#box.presetIndex.getValue()}
    get box(): SoundfontDeviceBox {return this.#box}
    get uuid(): UUID.Bytes {return this.#box.address.uuid}
    get address(): Address {return this.#box.address}
    get labelField(): StringField {return this.#box.label}
    get iconField(): StringField {return this.#box.icon}
    get defaultTrackType(): TrackType {return TrackType.Notes}
    get enabledField(): BooleanField {return this.#box.enabled}
    get minimizedField(): BooleanField {return this.#box.minimized}
    get acceptsMidiEvents(): boolean {return true}

    deviceHost(): DeviceHost {
        return this.#context.boxAdapters
            .adapterFor(this.#box.host.targetVertex.unwrap("no device-host").box, Devices.isHost)
    }

    audioUnitBoxAdapter(): AudioUnitBoxAdapter {return this.deviceHost().audioUnitBoxAdapter()}

    *labeledAudioOutputs(): Iterable<LabeledAudioOutput> {
        yield {address: this.address, label: this.labelField.getValue(), children: () => Option.None}
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#loaderGeneration++
        this.#terminator.terminate()
        this.#loaderSubscription.terminate()
        this.#loaderSubscription = Terminable.Empty
        this.#parametric.terminate()
    }

    #wrapParameters(_box: SoundfontDeviceBox) {
        return {} as const
    }

    readonly #loaderObserver = (option: Option<SoundfontLoader>) => {
        const generation = ++this.#loaderGeneration
        this.#loaderSubscription.terminate()
        this.#loaderSubscription = Terminable.Empty
        if (this.#terminated) {return}
        const current = () => !this.#terminated && generation === this.#loaderGeneration
        const publish = (font: Option<SoundFont2>) => {
            if (!current()) {return}
            this.#soundfont.wrapOption(font)
            if (!current()) {return}
            this.#preset.wrapOption(font.flatMap(soundfont =>
                Option.wrap(soundfont.presets[this.presetIndex] ?? soundfont.presets[0])))
        }
        option.match({
            none: () => publish(Option.None),
            some: loader => {
                publish(loader.soundfont)
                if (!current() || loader.soundfont.nonEmpty()) {return}
                const subscription = loader.subscribe(state => {
                    if (!current()) {return}
                    if (state.type === "loaded") {
                        publish(loader.soundfont)
                    } else if (state.type === "error" || state.type === "idle") {
                        publish(Option.None)
                    }
                })
                if (current()) {
                    this.#loaderSubscription = subscription
                } else {
                    subscription.terminate()
                }
            }
        })
    }
}
