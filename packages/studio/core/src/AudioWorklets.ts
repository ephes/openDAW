import {asDefined, int, Option} from "@opendaw/lib-std"
import {ExportConfiguration, ProcessorOptions, RingBuffer} from "@opendaw/studio-adapters"
import {Project} from "./project"
import {EngineWorklet} from "./EngineWorklet"
import {MeterWorklet} from "./MeterWorklet"
import {RecordingWorklet} from "./RecordingWorklet"
import {RenderQuantum} from "./RenderQuantum"

export class AudioWorklets {
    static install(url: string): void {
        console.debug(`WorkletUrl: '${url}'`)
        this.#workletUrl = Option.wrap(url)
    }

    static get processorsUrl(): string {
        return this.#workletUrl.unwrap("WorkletUrl is missing (call 'install' first)")
    }

    static #workletUrl: Option<string> = Option.None

    static createFor(context: BaseAudioContext): Promise<AudioWorklets> {
        const existing = this.#installations.get(context)
        if (existing !== undefined) {return existing}
        // Defer execution until the pending owner is registered, including synchronous addModule failures.
        const installation = Promise.resolve().then(() => context.audioWorklet.addModule(this.processorsUrl)).then(() => {
            const worklets = new AudioWorklets(context)
            this.#map.set(context, worklets)
            return worklets
        }).catch(error => {
            if (this.#installations.get(context) === installation) {this.#installations.delete(context)}
            throw error
        })
        this.#installations.set(context, installation)
        return installation
    }

    static get(context: BaseAudioContext): AudioWorklets {return asDefined(this.#map.get(context), "Worklets not installed")}

    static readonly #installations = new WeakMap<BaseAudioContext, Promise<AudioWorklets>>()

    static #map: WeakMap<BaseAudioContext, AudioWorklets> = new WeakMap<AudioContext, AudioWorklets>()

    readonly #context: BaseAudioContext

    constructor(context: BaseAudioContext) {this.#context = context}

    get context(): BaseAudioContext {return this.#context}

    createMeter(numberOfChannels: int): MeterWorklet {
        return new MeterWorklet(this.#context, numberOfChannels)
    }

    createEngine({project, exportConfiguration, options}: {
        project: Project,
        exportConfiguration?: ExportConfiguration,
        options?: ProcessorOptions
    }): EngineWorklet {
        return new EngineWorklet(this.#context, project, exportConfiguration, options)
    }

    /** Admission budget excludes the two 32-bit ring pointers. */
    static readonly MAX_RECORDING_AUDIO_BYTES = 64 * 1024 * 1024

    createRecording(numberOfChannels: int, numChunks: int): RecordingWorklet {
        if (!Number.isSafeInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 32
            || !Number.isSafeInteger(numChunks) || numChunks < 2) {
            throw new RangeError("Invalid recording ring geometry")
        }
        const audioBytes = numberOfChannels * numChunks * RenderQuantum * Float32Array.BYTES_PER_ELEMENT
        if (!Number.isSafeInteger(audioBytes) || audioBytes > AudioWorklets.MAX_RECORDING_AUDIO_BYTES) {
            throw new RangeError("Recording ring exceeds 64 MiB audio budget")
        }
        const pointerBytes = Int32Array.BYTES_PER_ELEMENT * 2
        const sab = new SharedArrayBuffer(audioBytes + pointerBytes)
        const buffer: RingBuffer.Config = {sab, numChunks, numberOfChannels, bufferSize: RenderQuantum}
        return new RecordingWorklet(this.#context, buffer)
    }
}