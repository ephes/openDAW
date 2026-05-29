import {Arrays, int, Terminator, tryCatch} from "@opendaw/lib-std"
import {CaptureChannelMap} from "./CaptureChannelMap"
import {CaptureSource, CaptureSourceMetadata} from "./CaptureSourceTypes"

export interface SyntheticCaptureSourceConfig {
    readonly context: BaseAudioContext
    readonly numberOfChannels: int
    readonly label?: string
    readonly baseFrequencyHz?: number
    readonly amplitude?: number
    readonly channelMap?: CaptureChannelMap
}

export class SyntheticCaptureSource implements CaptureSource {
    readonly #terminator = new Terminator()
    readonly #metadata: CaptureSourceMetadata
    readonly #outputNode: AudioNode
    readonly #oscillators: ReadonlyArray<OscillatorNode>

    constructor(config: SyntheticCaptureSourceConfig) {
        const {context, numberOfChannels, label = `synthetic-${numberOfChannels}ch`} = config
        const baseFrequencyHz = config.baseFrequencyHz ?? 440
        const amplitude = config.amplitude ?? 0.25
        const channelMap = config.channelMap ?? CaptureChannelMap.identity(numberOfChannels)
        CaptureChannelMap.validate(channelMap, numberOfChannels)
        const sourceMerger = context.createChannelMerger(numberOfChannels)
        const oscillators: Array<OscillatorNode> = []
        for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex++) {
            const oscillator = context.createOscillator()
            oscillator.type = "sine"
            oscillator.frequency.value = baseFrequencyHz * (channelIndex + 1)
            const gain = context.createGain()
            gain.gain.value = amplitude
            oscillator.connect(gain)
            gain.connect(sourceMerger, 0, channelIndex)
            oscillator.start()
            oscillators.push(oscillator)
        }
        this.#oscillators = oscillators
        const output: AudioNode = CaptureChannelMap.isIdentity(channelMap)
            ? sourceMerger
            : CaptureChannelMap.route(context, sourceMerger, numberOfChannels, channelMap)
        this.#outputNode = output
        this.#metadata = {
            kind: "synthetic",
            label,
            requestedSampleRate: context.sampleRate,
            requestedChannels: numberOfChannels,
            actualSampleRate: context.sampleRate,
            deviceChannels: numberOfChannels,
            actualChannels: channelMap.length,
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
        }
        this.#terminator.own({
            terminate: () => {
                for (const oscillator of this.#oscillators) {
                    tryCatch(() => oscillator.stop())
                    oscillator.disconnect()
                }
                sourceMerger.disconnect()
            }
        })
    }

    get metadata(): CaptureSourceMetadata {return this.#metadata}

    get outputNode(): AudioNode {return this.#outputNode}

    terminate(): void {this.#terminator.terminate()}
}

export namespace SyntheticCaptureSource {
    export const buildChannelMap = (sourceChannels: int, mapping: CaptureChannelMap): CaptureChannelMap => {
        CaptureChannelMap.validate(mapping, sourceChannels)
        return Arrays.create(index => mapping[index], mapping.length)
    }
}
