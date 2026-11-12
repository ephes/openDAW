import {LiveStreamBroadcaster} from "@opendaw/lib-fusion"
import {Address} from "@opendaw/lib-box"
import {Bits, int, Terminable, Terminator} from "@opendaw/lib-std"

export class NoteBroadcaster implements Terminable {
    readonly #terminator = new Terminator()
    readonly #broadcaster: LiveStreamBroadcaster
    readonly #address: Address

    readonly #bits: Bits
    readonly #counts: Uint16Array

    constructor(broadcaster: LiveStreamBroadcaster, address: Address) {
        this.#broadcaster = broadcaster
        this.#address = address

        this.#bits = new Bits(128)
        this.#counts = new Uint16Array(128)
        this.#terminator.own(
            this.#broadcaster.broadcastIntegers(this.#address, new Int32Array(this.#bits.buffer), (_hasSubscribers) => {})
        )
    }

    noteOn(note: int): void {
        if (note >= 0 && note < 128 && this.#counts[note] < 0xFFFF) {
            this.#counts[note]++
            this.#bits.setBit(note, true)
        }
    }
    noteOff(note: int): void {
        if (note >= 0 && note < 128 && this.#counts[note] > 0) {
            this.#bits.setBit(note, --this.#counts[note] > 0)
        }
    }

    reset(): void {this.clear()}
    clear(): void {
        this.#bits.clear()
        this.#counts.fill(0)
    }
    terminate(): void {this.#terminator.terminate()}
    toString(): string {return `{${this.constructor.name}}`}
}