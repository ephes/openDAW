import {Option, SortedSet, Terminable} from "@opendaw/lib-std"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Processor} from "./processing"

export type AudioOutputBuffer = {
    readonly address: Address
    readonly buffer: AudioBuffer
    readonly processor: Processor
}

export class AudioOutputBufferRegistry {
    readonly #outputs: SortedSet<Address, AudioOutputBuffer>

    constructor() {
        this.#outputs = Address.newSet<AudioOutputBuffer>(({address}) => address)
    }

    register(address: Address, buffer: AudioBuffer, processor: Processor): Terminable {
        const output = {address, buffer, processor}
        if (!this.#outputs.add(output)) {return Terminable.Empty}
        return {terminate: () => {
            if (this.#outputs.opt(address).contains(output)) {this.#outputs.removeByKey(address)}
        }}
    }

    resolve(address: Address): Option<AudioOutputBuffer> {
        return this.#outputs.opt(address)
    }
}
