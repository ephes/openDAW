import {Arrays, asInstanceOf, int, isDefined, Nullable, Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioEffectDeviceAdapter, WerkstattDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {WerkstattParameterBox} from "@opendaw/studio-boxes"
import {EngineContext} from "../../EngineContext"
import {Block, Processor} from "../../processing"
import {PeakBroadcaster} from "../../PeakBroadcaster"
import {AudioEffectDeviceProcessor} from "../../AudioEffectDeviceProcessor"
import {AudioBuffer, RenderQuantum} from "@opendaw/lib-dsp"
import {AudioProcessor} from "../../AudioProcessor"
import {AutomatableParameter} from "../../AutomatableParameter"

const HEADER_PATTERN = /^\/\/ @werkstatt (\w+) (\d+) (\d+)\n/
const MAX_AMPLITUDE = 1000.0 // ~60dB

const parseUpdate = (code: string): int => {
    const match = code.match(HEADER_PATTERN)
    return match !== null ? parseInt(match[3]) : -1
}

const validateOutput = (channels: ReadonlyArray<Float32Array>, s0: int, s1: int): Nullable<string> => {
    for (let ch = 0; ch < channels.length; ch++) {
        const channel = channels[ch]
        for (let i = s0; i < s1; i++) {
            const sample = channel[i]
            if (sample !== sample) {return `NaN detected in output channel ${ch} at sample ${i}`}
            if (sample > MAX_AMPLITUDE || sample < -MAX_AMPLITUDE) {
                return `Signal overflow in channel ${ch} at sample ${i} (amplitude: ${sample.toFixed(1)})`
            }
        }
    }
    return null
}

interface UserIO {
    src: ReadonlyArray<Float32Array>
    out: ReadonlyArray<Float32Array>
}

interface UserProcessor {
    process(io: UserIO, block: Block): void
    paramChanged?(label: string, value: number): void
}

export class WerkstattDeviceProcessor extends AudioProcessor implements AudioEffectDeviceProcessor {
    static ID: int = 0 | 0

    readonly #id: int = WerkstattDeviceProcessor.ID++

    readonly #adapter: WerkstattDeviceBoxAdapter
    readonly #engineToClient: EngineContext["engineToClient"]
    readonly #output: AudioBuffer
    readonly #peaks: PeakBroadcaster
    readonly #uuid: string
    readonly #boundParameters: Array<AutomatableParameter<number>>

    #source: Option<AudioBuffer> = Option.None
    #userProcessor: Option<UserProcessor> = Option.None
    #currentUpdate: int = -1
    #pendingUpdate: int = -1
    #silenced: boolean = false
    #scriptOutput: AudioBuffer = new AudioBuffer()
    #io: {src: [Float32Array, Float32Array], out: [Float32Array, Float32Array]}

    constructor(context: EngineContext, adapter: WerkstattDeviceBoxAdapter) {
        super(context)
        this.#adapter = adapter
        this.#engineToClient = context.engineToClient
        this.#output = new AudioBuffer()
        this.#peaks = this.own(new PeakBroadcaster(context.broadcaster, adapter.address))
        this.#uuid = UUID.toString(adapter.uuid)
        this.#boundParameters = []
        this.#io = {
            src: [this.#output.getChannel(0), this.#output.getChannel(1)],
            out: [this.#scriptOutput.getChannel(0), this.#scriptOutput.getChannel(1)]
        }
        const {parameters, box} = adapter
        this.ownAll(
            box.code.catchupAndSubscribe(owner => {
                const newUpdate = parseUpdate(owner.getValue())
                if (newUpdate > 0 && newUpdate !== this.#currentUpdate) {
                    this.#silenced = true
                    this.#pendingUpdate = newUpdate
                    this.#userProcessor = Option.None
                    this.#output.clear()
                    this.#tryLoad(newUpdate)
                }
            }),
            box.parameters.pointerHub.catchupAndSubscribe({
                onAdded: (({box}) => {
                    const paramBox = asInstanceOf(box, WerkstattParameterBox)
                    const bound = this.bindParameter(parameters.parameterAt(paramBox.value.address))
                    this.#boundParameters.push(bound)
                    this.parameterChanged(bound)
                }),
                onRemoved: (({box}) => {
                    const paramBox = asInstanceOf(box, WerkstattParameterBox)
                    Arrays.removeIf(this.#boundParameters, parameter =>
                        parameter.address === paramBox.value.address)
                })
            }),
            context.registerProcessor(this),
            context.audioOutputBufferRegistry.register(adapter.address, this.#output, this.outgoing)
        )
        this.readAllParameters()
    }

    #tryLoad(expectedUpdate: int): void {
        const registry = (globalThis as typeof globalThis & {openDAW?: {werkstattProcessors?: Record<string, {update: number, create: new () => UserProcessor}>}}).openDAW?.werkstattProcessors?.[this.#uuid]
        if (isDefined(registry) && registry.update === expectedUpdate) {
            this.#swapProcessor(registry.create, expectedUpdate)
        }
    }

    #swapProcessor(ProcessorClass: new () => UserProcessor, update: int): void {
        // A matching registry entry is attempted once, including failed construction.
        // Missing entries keep polling without consuming the pending generation.
        this.#currentUpdate = update
        try {
            this.#userProcessor = Option.wrap(new ProcessorClass() as UserProcessor)
            // Script-owned staging keeps detached buffers away from published audio.
            this.#scriptOutput = new AudioBuffer()
            this.#io = {
                src: [this.#output.getChannel(0), this.#output.getChannel(1)],
                out: [this.#scriptOutput.getChannel(0), this.#scriptOutput.getChannel(1)]
            }
            this.#silenced = false
            this.#pushAllParameters()
        } catch (error) {
            this.#silence(`Failed to instantiate Processor: ${error}`)
        }
    }

    #pushAllParameters(): void {
        for (const bound of this.#boundParameters) {
            if (this.#silenced) {return}
            this.parameterChanged(bound)
        }
    }

    #reportError(message: string): void {
        this.#engineToClient.deviceMessage(this.#uuid, message)
    }

    #silence(message: string): void {
        this.#silenced = true
        this.#userProcessor = Option.None
        this.#output.clear()
        this.#reportError(message)
    }

    parameterChanged(parameter: AutomatableParameter): void {
        if (this.#silenced) {return}
        try {
            this.#userProcessor.ifSome(proc => {
                if (isDefined(proc.paramChanged)) {
                    const paramBox = asInstanceOf(parameter.adapter.field.box, WerkstattParameterBox)
                    proc.paramChanged(paramBox.label.getValue(), parameter.getValue())
                }
            })
        } catch (error) {
            this.#silence(`Parameter callback error: ${error}`)
        }
    }

    get incoming(): Processor {return this}
    get outgoing(): Processor {return this}

    reset(): void {
        this.#peaks.clear()
        this.#output.clear()
        this.eventInput.clear()
    }

    get uuid(): UUID.Bytes {return this.#adapter.uuid}
    get audioOutput(): AudioBuffer {return this.#output}

    setAudioSource(source: AudioBuffer): Terminable {
        const attachment = Option.wrap(source)
        this.#source = attachment
        return {terminate: () => {
            if (this.#source === attachment) {this.#source = Option.None}
        }}
    }

    index(): int {return this.#adapter.indexField.getValue()}
    adapter(): AudioEffectDeviceAdapter {return this.#adapter}

    processAudio(block: Block): void {
        if (this.#silenced) {
            if (this.#pendingUpdate > 0 && this.#pendingUpdate !== this.#currentUpdate) {
                this.#tryLoad(this.#pendingUpdate)
            }
            if (this.#silenced) {return}
        }
        if (this.#source.isEmpty()) {
            this.#output.clear(block.s0, block.s1)
            return
        }
        if (this.#userProcessor.isEmpty()) {return}
        const source = this.#source.unwrap()
        const proc = this.#userProcessor.unwrap()
        const left = this.#scriptOutput.getChannel(0)
        const right = this.#scriptOutput.getChannel(1)
        const owned = this.#io.out
        try {
            this.#io.src[0] = source.getChannel(0)
            this.#io.src[1] = source.getChannel(1)
            this.#scriptOutput.clear(block.s0, block.s1)
            proc.process(this.#io, block)
            if (this.#io.out !== owned || this.#io.out.length !== 2
                || this.#io.out[0] !== left || this.#io.out[1] !== right
                || left.length !== RenderQuantum || right.length !== RenderQuantum) {
                this.#silence("Output buffer contract changed: use the two supplied buffers in place")
                return
            }
            const validationError = validateOutput(this.#scriptOutput.channels(), block.s0, block.s1)
            if (validationError !== null) {
                this.#silence(validationError)
                return
            }
            const publishedLeft = this.#output.getChannel(0)
            const publishedRight = this.#output.getChannel(1)
            for (let i = block.s0; i < block.s1; i++) {
                publishedLeft[i] = left[i]
                publishedRight[i] = right[i]
            }
            this.#peaks.process(left, right, block.s0, block.s1)
        } catch (error) {
            this.#silence(`Runtime error: ${error}`)
        }
    }

    toString(): string {return `{${this.constructor.name} (${this.#id})`}
}
