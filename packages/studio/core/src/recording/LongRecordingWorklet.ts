import {int, Terminable, Terminator} from "@opendaw/lib-std"
import {RingBuffer} from "@opendaw/studio-adapters"
import {RenderQuantum} from "../RenderQuantum"
import {LongRecordingSession} from "./LongRecordingSession"

export class LongRecordingWorklet extends AudioWorkletNode implements Terminable {
    readonly #terminator: Terminator = new Terminator()
    readonly #session: LongRecordingSession
    readonly #reader: RingBuffer.Reader
    #active: boolean = true

    constructor(context: BaseAudioContext, session: LongRecordingSession, config: RingBuffer.Config) {
        super(context, "recording-processor", {
            numberOfInputs: 1,
            channelCount: config.numberOfChannels,
            channelCountMode: "explicit",
            processorOptions: config
        })
        this.#session = session
        this.#reader = RingBuffer.reader(config, channels => {
            if (!this.#active) {return}
            this.#session.appendQuantum(channels)
        })
    }

    get session(): LongRecordingSession {return this.#session}

    own<T extends Terminable>(terminable: T): T {return this.#terminator.own(terminable)}

    terminate(): void {
        this.#active = false
        this.#reader.stop()
        this.#terminator.terminate()
        this.disconnect()
    }

    toString(): string {return `{LongRecordingWorklet}`}
}

export namespace LongRecordingWorklet {
    export const buildConfig = (numberOfChannels: int, numChunks: int = RenderQuantum): RingBuffer.Config => {
        const audioBytes = numberOfChannels * numChunks * RenderQuantum * Float32Array.BYTES_PER_ELEMENT
        const pointerBytes = Int32Array.BYTES_PER_ELEMENT * 2
        const sab = new SharedArrayBuffer(audioBytes + pointerBytes)
        return {sab, numChunks, numberOfChannels, bufferSize: RenderQuantum}
    }
}
