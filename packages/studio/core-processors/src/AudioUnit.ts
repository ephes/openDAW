import {AudioUnitBoxAdapter, AudioUnitInputAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "./EngineContext"
import {asInstanceOf, int, Option, Terminable, Terminator} from "@opendaw/lib-std"
import {InstrumentDeviceProcessorFactory} from "./DeviceProcessorFactory"
import {AudioBusProcessor} from "./AudioBusProcessor"
import {AudioBuffer, AudioData} from "@opendaw/lib-dsp"
import {AudioDeviceChain} from "./AudioDeviceChain"
import {MidiDeviceChain} from "./MidiDeviceChain"
import {AudioUnitOptions} from "./AudioUnitOptions"
import {InstrumentDeviceProcessor} from "./InstrumentDeviceProcessor"
import {FrozenPlaybackProcessor} from "./FrozenPlaybackProcessor"
import {Processor} from "./processing"

export class AudioUnit implements Terminable {
    static ID: int = 0 | 0

    readonly #id: int = AudioUnit.ID++

    readonly #terminator = new Terminator()

    readonly #context: EngineContext
    readonly #adapter: AudioUnitBoxAdapter

    readonly #midiDeviceChain: MidiDeviceChain
    readonly #audioDeviceChain: AudioDeviceChain

    #input: Option<InstrumentDeviceProcessor | AudioBusProcessor> = Option.None
    #frozen: Option<{data: AudioData, processor: FrozenPlaybackProcessor}> = Option.None
    #preChannelStripSource: Option<AudioBuffer> = Option.None

    readonly #useInstrumentOutput: boolean
    readonly #skipChannelStrip: boolean

    constructor(context: EngineContext, adapter: AudioUnitBoxAdapter, options: AudioUnitOptions) {
        this.#context = context
        this.#adapter = adapter
        this.#useInstrumentOutput = options.useInstrumentOutput
        this.#skipChannelStrip = options.skipChannelStrip === true

        this.#midiDeviceChain = this.#terminator.own(new MidiDeviceChain(this))
        this.#audioDeviceChain = this.#terminator.own(new AudioDeviceChain(this, options))

        this.#terminator.ownAll(
            this.#adapter.input.catchupAndSubscribe(owner => {
                const next = this.#prepareSource(context => owner.flatMap((input: AudioUnitInputAdapter) =>
                    Option.wrap(InstrumentDeviceProcessorFactory.create(context, input.box.box))))
                this.#midiDeviceChain.invalidateWiring()
                this.#audioDeviceChain.invalidateWiring()
                const previous = this.#input
                this.#input = next
                previous.ifSome(input => input.terminate())
            })
        )
    }

    input(): Option<InstrumentDeviceProcessor | AudioBusProcessor> {return this.#input}
    inputAsAudioBus(): AudioBusProcessor {return asInstanceOf(this.#input.unwrap("No input available"), AudioBusProcessor)}
    audioOutput(): AudioBuffer {
        if (this.#useInstrumentOutput) {return this.#input.unwrap().audioOutput}
        if (this.#skipChannelStrip && this.#preChannelStripSource.nonEmpty()) {
            return this.#preChannelStripSource.unwrap()
        }
        return this.#audioDeviceChain.channelStrip.audioOutput
    }
    get frozen(): Option<{data: AudioData, processor: FrozenPlaybackProcessor}> {return this.#frozen}
    get skipChannelStrip(): boolean {return this.#skipChannelStrip}
    setFrozenAudio(data: Option<AudioData>): void {
        const next = this.#prepareSource(context => data.map(audioData => ({
            data: audioData,
            processor: new FrozenPlaybackProcessor(context, audioData)
        })))
        this.#midiDeviceChain.invalidateWiring()
        this.invalidateWiring()
        const previous = this.#frozen
        this.#frozen = next
        previous.ifSome(frozen => frozen.processor.terminate())
    }
    setPreChannelStripSource(source: Option<AudioBuffer>): void {this.#preChannelStripSource = source}

    get midiDeviceChain(): MidiDeviceChain {return this.#midiDeviceChain}
    get audioDeviceChain(): AudioDeviceChain {return this.#audioDeviceChain}
    get context(): EngineContext {return this.#context}
    get adapter(): AudioUnitBoxAdapter {return this.#adapter}
    invalidateWiring(): void {this.#audioDeviceChain.invalidateWiring()}
    setMonitoringChannels(channels: ReadonlyArray<int>): void {this.#audioDeviceChain.setMonitoringChannels(channels)}
    clearMonitoringChannels(): void {this.#audioDeviceChain.clearMonitoringChannels()}

    terminate(): void {
        this.#frozen.ifSome(frozen => frozen.processor.terminate())
        this.#frozen = Option.None
        this.#terminator.terminate()
        this.#input.ifSome(input => input.terminate())
        this.#input = Option.None
    }

    // Construction can register processors/edges before throwing. Keep temporary
    // ownership of those public leases until a complete replacement is available.
    #prepareSource<T>(create: (context: EngineContext) => T): T {
        let pending: Terminator | undefined = new Terminator()
        const own = (lease: Terminable): Terminable => {
            if (pending === undefined) {return lease}
            let attached = true
            const once = {terminate: () => {
                if (!attached) {return}
                attached = false
                lease.terminate()
            }}
            return pending.own(once)
        }
        const context = new Proxy(this.#context, {get: (target, key) => {
            if (key === "registerProcessor") {
                return (processor: Processor) => {
                    const registration = own(target.registerProcessor(processor))
                    const terminable = processor as Processor & Partial<Terminable>
                    if (typeof terminable.terminate === "function") {
                        pending?.own({terminate: () => terminable.terminate!()})
                    }
                    return registration
                }
            }
            if (key === "registerEdge") {
                return (source: Processor, destination: Processor) => own(target.registerEdge(source, destination))
            }
            const value = Reflect.get(target, key, target)
            return typeof value === "function" ? value.bind(target) : value
        }})
        try {
            const result = create(context)
            pending = undefined // The completed source now owns its leases.
            return result
        } catch (error) {
            try {pending?.terminate()} catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Source construction and cleanup failed", {cause: error})
            }
            throw error
        }
    }

    toString(): string {return `{${this.constructor.name}(${this.#id})}`}
}