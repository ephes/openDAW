import {assert, ByteArrayInput, ByteArrayOutput, Hash} from "@opendaw/lib-std"
import {Update} from "@opendaw/lib-box"
import {Project} from "../project/Project"

export const enum CommitType { Init, Open, Updates, NewVersion }

export class Commit {
    static readonly VERSION = 2

    static readonly #NO_PAYLOAD = new Uint8Array(1).buffer
    static readonly #EMPTY_HASH = new Uint8Array(32).buffer

    static createFirst(project: Project): Promise<Commit> {
        const payload = project.toArrayBuffer() as ArrayBuffer
        return this.#create(CommitType.Init, Commit.#EMPTY_HASH, payload)
    }

    static createOpen(prevHash: ArrayBuffer): Promise<Commit> {
        return this.#create(CommitType.Open, prevHash, Commit.#NO_PAYLOAD)
    }

    static async createUpdate(prevHash: ArrayBuffer, updates: ReadonlyArray<Update>): Promise<Commit> {
        const output = ByteArrayOutput.create()
        output.writeInt(updates.length)
        updates.forEach(update => update.write(output))
        return this.#create(CommitType.Updates, prevHash, output.toArrayBuffer() as ArrayBuffer)
    }

    static async #create(type: CommitType, prevHash: ArrayBuffer, payload: ArrayBuffer): Promise<Commit> {
        const date = Date.now()
        // Own the bytes before yielding to WebCrypto.
        prevHash = prevHash.slice(0)
        payload = payload.slice(0)
        const thisHash = await this.#digest(type, Commit.VERSION, prevHash, payload, date)
        return new Commit(type, prevHash, thisHash, payload, date, Commit.VERSION)
    }

    static #digest(type: CommitType, version: number, prevHash: ArrayBuffer, payload: ArrayBuffer, date: number): Promise<ArrayBuffer> {
        const output = ByteArrayOutput.create()
        output.writeString("openDAW-sync-log")
        output.writeInt(type)
        output.writeInt(version)
        output.writeBytes(new Int8Array(prevHash))
        output.writeInt(payload.byteLength)
        output.writeBytes(new Int8Array(payload))
        output.writeDouble(date)
        return Hash.fromBuffers(output.toArrayBuffer())
    }

    async verify(allowLegacy: boolean = false): Promise<void> {
        if (this.version === 1) {
            assert(allowLegacy, "Legacy sync logs have no payload integrity; explicit opt-in required")
            return
        }
        const digest = await Commit.#digest(this.type, this.version, this.prevHash, this.payload, this.date)
        assert(Hash.equals(digest, this.thisHash), "Sync-log digest mismatch")
    }

    static deserialize(input: ByteArrayInput): Commit {
        assert(input.available(84), "Truncated sync-log record")
        const type = input.readInt() as CommitType
        assert(type === CommitType.Init
            || type === CommitType.Open
            || type === CommitType.Updates
            || type === CommitType.NewVersion,
            `Unknown commit type "${type}"`)
        const version = input.readInt()
        assert(version === 1 || version === Commit.VERSION, "Unsupported sync-log version")
        const prevHash = new Int8Array(32)
        input.readBytes(prevHash)
        const thisHash = new Int8Array(32)
        input.readBytes(thisHash)
        const length = input.readInt()
        assert(length >= 0 && length <= input.remaining() - 8, "Invalid sync-log payload length")
        const data = new Int8Array(length)
        input.readBytes(data)
        const date = input.readDouble()
        return new Commit(type, prevHash.buffer, thisHash.buffer, data.buffer, date, version)
    }

    private constructor(readonly type: CommitType,
                        readonly prevHash: ArrayBuffer,
                        readonly thisHash: ArrayBuffer,
                        readonly payload: ArrayBuffer,
                        readonly date: number,
                        readonly version: number) {}

    serialize(): ArrayBuffer {
        const output = ByteArrayOutput.create()
        output.writeInt(this.type)
        output.writeInt(this.version)
        output.writeBytes(new Int8Array(this.prevHash))
        output.writeBytes(new Int8Array(this.thisHash))
        output.writeInt(this.payload.byteLength)
        output.writeBytes(new Int8Array(this.payload))
        output.writeDouble(this.date)
        return output.toArrayBuffer() as ArrayBuffer
    }

    toString(): string {
        return `{prevHash: ${Hash.toString(this.prevHash)}, thisHash: ${Hash.toString(this.thisHash)}, payload: ${this.payload.byteLength}bytes}`
    }
}