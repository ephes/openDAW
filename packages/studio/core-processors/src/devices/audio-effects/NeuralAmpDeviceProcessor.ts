import {EngineToClient, NeuralAmpDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {int, isDefined, Nullable, Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioAnalyser, AudioBuffer, dbToGain, Event, RenderQuantum, StereoMatrix} from "@opendaw/lib-dsp"
import {EngineContext} from "../../EngineContext"
import {Block, Processor} from "../../processing"
import {PeakBroadcaster} from "../../PeakBroadcaster"
import {AudioProcessor} from "../../AudioProcessor"
import {AutomatableParameter} from "../../AutomatableParameter"
import {AudioEffectDeviceProcessor} from "../../AudioEffectDeviceProcessor"
import {createNamModule, NamWasmModule} from "@opendaw/nam-wasm"

export class NeuralAmpDeviceProcessor extends AudioProcessor implements AudioEffectDeviceProcessor {
    static ID: int = 0 | 0

    // Singleton WASM module - shared across all instances
    static #wasmModule: Option<NamWasmModule> = Option.None
    static #wasmLoading: Nullable<Promise<NamWasmModule>> = null

    static async fetchWasm(engineToClient: EngineToClient): Promise<NamWasmModule> {
        if (this.#wasmModule.nonEmpty()) {
            return this.#wasmModule.unwrap()
        }
        if (isDefined(this.#wasmLoading)) {
            return this.#wasmLoading
        }
        const loading = (async () => {
            const wasmBinary = await engineToClient.fetchNamWasm()
            const emscriptenModule = await createNamModule({
                wasmBinary,
                locateFile: () => "" // Prevent URL usage in worklet context
            })
            const module = NamWasmModule.fromModule(emscriptenModule)
            module.setSampleRate(sampleRate)
            this.#wasmModule = Option.wrap(module)
            return module
        })()
        this.#wasmLoading = loading
        try {
            return await loading
        } finally {
            if (this.#wasmLoading === loading) {this.#wasmLoading = null}
        }
    }

    readonly #id: int = NeuralAmpDeviceProcessor.ID++
    readonly #context: EngineContext
    readonly #adapter: NeuralAmpDeviceBoxAdapter

    readonly parameterInputGain: AutomatableParameter<number>
    readonly parameterOutputGain: AutomatableParameter<number>
    readonly parameterMix: AutomatableParameter<number>

    readonly #output: AudioBuffer
    readonly #peaks: PeakBroadcaster
    readonly #audioAnalyser: AudioAnalyser
    readonly #spectrum: Float32Array
    readonly #inputs: [Float32Array, Float32Array]
    readonly #outputs: [Float32Array, Float32Array]

    #needsSpectrum: boolean = false
    #pendingModelJson: string = ""
    #modelApplyPending: boolean = false
    #modelApplyFailed: boolean = false
    #source: Option<AudioBuffer> = Option.None
    #instances: [int, int] = [-1, -1]
    #modelLoaded: boolean = false
    #inputGain: number = 1.0
    #outputGain: number = 1.0
    #mono: boolean = true
    #mix: number = 1.0
    #terminated: boolean = false
    #processFailed: boolean = false

    constructor(context: EngineContext, adapter: NeuralAmpDeviceBoxAdapter) {
        super(context)
        this.#context = context
        this.#adapter = adapter
        this.#output = new AudioBuffer()
        this.#peaks = this.own(new PeakBroadcaster(context.broadcaster, adapter.address))
        this.#audioAnalyser = new AudioAnalyser({decay: 0.96})
        this.#spectrum = new Float32Array(this.#audioAnalyser.numBins())
        this.#inputs = [new Float32Array(RenderQuantum), new Float32Array(RenderQuantum)]
        this.#outputs = [new Float32Array(RenderQuantum), new Float32Array(RenderQuantum)]
        const {namedParameter} = adapter
        this.parameterInputGain = this.own(this.bindParameter(namedParameter.inputGain))
        this.parameterOutputGain = this.own(this.bindParameter(namedParameter.outputGain))
        this.parameterMix = this.own(this.bindParameter(namedParameter.mix))
        this.ownAll(
            context.registerProcessor(this),
            context.audioOutputBufferRegistry.register(adapter.address, this.#output, this.outgoing),
            adapter.modelField.catchupAndSubscribe(() => this.#onModelChanged()),
            adapter.monoField.catchupAndSubscribe(field => this.#onMonoChanged(field.getValue())),
            context.broadcaster.broadcastFloats(adapter.spectrum, this.#spectrum, (hasSubscribers) => {
                this.#needsSpectrum = hasSubscribers
                if (!hasSubscribers) {return}
                this.#spectrum.set(this.#audioAnalyser.bins())
                this.#audioAnalyser.decay = true
            })
        )
        this.#initInstance()
        this.readAllParameters()
        const initialModelJson = adapter.getModelJson()
        if (initialModelJson.length > 0) {
            context.awaitResource(NeuralAmpDeviceProcessor.fetchWasm(context.engineToClient))
        }
    }

    get incoming(): Processor {return this}
    get outgoing(): Processor {return this}

    reset(): void {
        this.#output.clear()
        this.#peaks.clear()
        this.eventInput.clear()
        if (this.#terminated) {return}
        const module = NeuralAmpDeviceProcessor.#wasmModule
        if (module.nonEmpty()) {
            const wasm = module.unwrap()
            for (const instance of this.#instances) {
                if (instance >= 0) {
                    try {
                        wasm.reset(instance)
                    } catch (error) {
                        console.error("NAM reset failed:", error)
                    }
                }
            }
        }
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
    adapter(): NeuralAmpDeviceBoxAdapter {return this.#adapter}

    handleEvent(_event: Event): void {}

    processAudio({s0, s1}: Block): void {
        if (this.#terminated || this.#source.isEmpty()) {
            this.#output.clear(s0, s1)
            return
        }
        const [inL, inR] = this.#source.unwrap().channels() as StereoMatrix.Channels
        const [outL, outR] = this.#output.channels() as StereoMatrix.Channels
        const numFrames = s1 - s0
        const module = NeuralAmpDeviceProcessor.#wasmModule
        if (this.#modelApplyFailed && module.nonEmpty()) {
            this.#modelApplyFailed = false
            this.#initInstance()
            this.#applyModel()
        }
        if (module.isEmpty() || !this.#modelLoaded || this.#instances[0] < 0) {
            for (let i = s0; i < s1; i++) {
                outL[i] = inL[i]
                outR[i] = inR[i]
            }
            this.#peaks.process(outL, outR, s0, s1)
            return
        }
        const wasm = module.unwrap()
        const [bufInL, bufInR] = this.#inputs
        const [bufOutL, bufOutR] = this.#outputs
        const [instanceL, instanceR] = this.#instances
        const inputGain = this.#inputGain
        const outputGain = this.#outputGain
        const wet = this.#mix
        const dry = 1.0 - wet
        try {
            if (this.#mono) {
                for (let i = 0; i < numFrames; i++) {
                    bufInL[i] = (inL[s0 + i] + inR[s0 + i]) * 0.5 * inputGain
                }
                wasm.process(instanceL, bufInL.subarray(0, numFrames), bufOutL.subarray(0, numFrames))
                for (let i = 0; i < numFrames; i++) {
                    const wetSample = bufOutL[i] * outputGain
                    outL[s0 + i] = inL[s0 + i] * dry + wetSample * wet
                    outR[s0 + i] = inR[s0 + i] * dry + wetSample * wet
                }
            } else {
                for (let i = 0; i < numFrames; i++) {
                    bufInL[i] = inL[s0 + i] * inputGain
                    bufInR[i] = inR[s0 + i] * inputGain
                }
                wasm.process(instanceL, bufInL.subarray(0, numFrames), bufOutL.subarray(0, numFrames))
                wasm.process(instanceR, bufInR.subarray(0, numFrames), bufOutR.subarray(0, numFrames))
                for (let i = 0; i < numFrames; i++) {
                    outL[s0 + i] = inL[s0 + i] * dry + bufOutL[i] * outputGain * wet
                    outR[s0 + i] = inR[s0 + i] * dry + bufOutR[i] * outputGain * wet
                }
            }
        } catch {
            this.#processFailed = true
            this.#modelApplyFailed = false
            try {this.#destroyInstances()} catch {
                // Cleanup attempts both channels and invalidates their handles first.
            }
            this.#audioAnalyser.clear()
            this.#spectrum.fill(0.0)
            for (let i = s0; i < s1; i++) {
                outL[i] = inL[i]
                outR[i] = inR[i]
            }
            console.error("NAM processing failed; select a different model or reopen the project to recover.")
        }
        this.#peaks.process(outL, outR, s0, s1)
        if (this.#needsSpectrum) {
            this.#audioAnalyser.process(outL, outR, s0, s1)
        }
    }

    parameterChanged(parameter: AutomatableParameter): void {
        if (parameter === this.parameterInputGain) {
            this.#inputGain = dbToGain(this.parameterInputGain.getValue())
        } else if (parameter === this.parameterOutputGain) {
            this.#outputGain = dbToGain(this.parameterOutputGain.getValue())
        } else if (parameter === this.parameterMix) {
            this.#mix = this.parameterMix.getValue()
        }
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        const errors: unknown[] = []
        try {super.terminate()} catch (error) {errors.push(error)}
        try {this.#destroyInstances()} catch (error) {errors.push(error)}
        if (errors.length > 0) {throw errors[0]}
    }

    toString(): string {return `{${this.constructor.name} (${this.#id})}`}

    #initInstance(): void {
        const module = NeuralAmpDeviceProcessor.#wasmModule
        if (module.nonEmpty()) {
            const wasm = module.unwrap()
            if (this.#instances[0] < 0) {
                this.#instances[0] = wasm.createInstance()
            }
            if (!this.#mono && this.#instances[1] < 0) {
                this.#instances[1] = wasm.createInstance()
            }
        }
    }

    static #destroyInstance(wasm: NamWasmModule, instance: int): void {
        const errors: unknown[] = []
        try {wasm.unloadModel(instance)} catch (error) {errors.push(error)}
        try {wasm.destroyInstance(instance)} catch (error) {errors.push(error)}
        if (errors.length > 0) {throw errors[0]}
    }

    #destroyInstances(): void {
        const instances = this.#instances
        this.#instances = [-1, -1]
        this.#modelLoaded = false
        const errors: unknown[] = []
        NeuralAmpDeviceProcessor.#wasmModule.ifSome(wasm => {
            for (const instance of instances) {
                if (instance < 0) {continue}
                try {NeuralAmpDeviceProcessor.#destroyInstance(wasm, instance)} catch (error) {errors.push(error)}
            }
        })
        if (errors.length > 0) {throw errors[0]}
    }

    #onMonoChanged(mono: boolean): void {
        if (this.#terminated) {return}
        if (this.#processFailed) {
            this.#mono = mono
            return
        }
        const module = NeuralAmpDeviceProcessor.#wasmModule
        if (module.isEmpty()) {
            this.#mono = mono
            return
        }
        const wasm = module.unwrap()
        if (mono) {
            this.#mono = true
            if (this.#instances[1] >= 0) {
                const instance = this.#instances[1]
                this.#instances[1] = -1
                try {
                    NeuralAmpDeviceProcessor.#destroyInstance(wasm, instance)
                } catch (error) {
                    console.error("NAM destroyInstance failed in onMonoChanged:", error)
                }
            }
        } else {
            if (this.#instances[1] < 0) {
                let instance = -1
                try {
                    instance = wasm.createInstance()
                    if (instance < 0 || (this.#modelLoaded && !wasm.loadModel(instance, this.#pendingModelJson))) {
                        throw new Error("NAM right model was not loaded")
                    }
                    this.#instances[1] = instance
                } catch (error) {
                    if (instance >= 0) {
                        try {
                            NeuralAmpDeviceProcessor.#destroyInstance(wasm, instance)
                        } catch (cleanupError) {
                            console.error("NAM right instance cleanup failed:", cleanupError)
                        }
                    }
                    console.error("NAM stereo activation failed:", error)
                    return
                }
            }
            this.#mono = false
        }
    }

    #onModelChanged(): void {
        this.#onModelJsonChanged(this.#adapter.getModelJson())
    }

    #onModelJsonChanged(modelJson: string): void {
        if (this.#terminated) {return}
        this.#processFailed = false
        this.#pendingModelJson = modelJson
        if (this.#modelApplyPending) {return}
        this.#modelApplyFailed = false
        const module = NeuralAmpDeviceProcessor.#wasmModule
        if (module.nonEmpty()) {
            this.#initInstance()
            this.#applyModel()
        } else {
            this.#modelApplyPending = true
            NeuralAmpDeviceProcessor.fetchWasm(this.#context.engineToClient)
                .then(() => {
                    this.#modelApplyPending = false
                    if (this.#terminated) {return}
                    this.#initInstance()
                    this.#applyModel()
                })
                .catch(error => {
                    this.#modelApplyPending = false
                    if (this.#terminated) {return}
                    this.#modelApplyFailed = true
                    console.error("Failed to load NAM WASM:", error)
                })
        }
    }

    #applyModel(): void {
        if (this.#terminated) {return}
        const module = NeuralAmpDeviceProcessor.#wasmModule
        if (module.isEmpty()) {
            this.#modelLoaded = false
            return
        }
        if (this.#instances[0] < 0) {
            this.#initInstance()
        }
        if (this.#instances[0] < 0) {
            this.#modelLoaded = false
            return
        }
        const wasm = module.unwrap()
        if (this.#pendingModelJson.length === 0) {
            for (const instance of this.#instances) {
                if (instance >= 0) {wasm.unloadModel(instance)}
            }
            this.#modelLoaded = false
            return
        }
        try {
            this.#modelLoaded = wasm.loadModel(this.#instances[0], this.#pendingModelJson)
            if (this.#instances[1] >= 0) {
                this.#modelLoaded = this.#modelLoaded && wasm.loadModel(this.#instances[1], this.#pendingModelJson)
            }
        } catch (error) {
            console.error("NAM loadModel failed:", error)
            this.#modelLoaded = false
        }
    }
}
