import {PrimitiveField, PrimitiveType, PrimitiveValues, ValueSerialization} from "./primitive"
import {Address} from "./address"
import {PointerField} from "./pointer"
import {ByteArrayInput, DataInput, DataOutput, Option, UUID} from "@opendaw/lib-std"
import {BoxGraph} from "./graph"

export type Update = NewUpdate | PrimitiveUpdate | PointerUpdate | DeleteUpdate

export namespace Updates {
    export class DecodeError extends Error {}
    export const decode = (input: DataInput): ReadonlyArray<Update> => {
        const remaining = (): number => {
            if (typeof input.remaining !== "function") {throw new DecodeError("Bounded update input required")}
            const bytes = input.remaining()
            if (!Number.isSafeInteger(bytes) || bytes < 0) {throw new DecodeError("Invalid update input size")}
            return bytes
        }
        const requireBytes = (count: number): void => {
            if (count < 0 || count > remaining()) {throw new DecodeError("Incomplete update payload")}
        }
        const readLength = (stride: number): number => {
            requireBytes(4)
            const length = input.readInt()
            if (length < 0 || length > Math.floor(remaining() / stride)) {throw new DecodeError("Invalid update length")}
            return length
        }
        const readString = (): string => {
            const length = readLength(2)
            let value = ""
            for (let index = 0; index < length; index++) {value += String.fromCharCode(input.readShort())}
            return value
        }
        const readBytes = (): Int8Array => {
            const bytes = new Int8Array(readLength(1))
            input.readBytes(bytes)
            return bytes
        }
        const readAddress = (): Address => {
            requireBytes(17)
            const uuid = UUID.fromDataInput(input)
            const count = input.readByte()
            if (count < 0 || count > Math.floor(remaining() / 2)) {throw new DecodeError("Invalid update address")}
            const keys = new Int16Array(count)
            for (let index = 0; index < count; index++) {keys[index] = input.readShort()}
            return new Address(uuid, keys)
        }
        const readBoolean = (): boolean => {
            requireBytes(1)
            const value = input.readByte()
            if (value !== 0 && value !== 1) {throw new DecodeError("Invalid update boolean")}
            return value === 1
        }
        const readValue = (type: PrimitiveType): PrimitiveValues => {
            switch (type) {
                case PrimitiveType.Boolean: return readBoolean()
                case PrimitiveType.Int32: requireBytes(4); return input.readInt()
                case PrimitiveType.Float32: requireBytes(4); return input.readFloat()
                case PrimitiveType.String: return readString()
                case PrimitiveType.Bytes: return readBytes()
            }
        }
        const readUpdate = (): Update => {
            switch (readString()) {
                case "new": {
                    requireBytes(16)
                    const uuid = UUID.fromDataInput(input)
                    const name = readString()
                    return new NewUpdate(uuid, name, readBytes().buffer)
                }
                case "pointer": {
                    const address = readAddress()
                    const oldAddress = readBoolean() ? Option.wrap(readAddress()) : Option.None
                    const newAddress = readBoolean() ? Option.wrap(readAddress()) : Option.None
                    return new PointerUpdate(address, oldAddress, newAddress)
                }
                case "primitive": {
                    const address = readAddress()
                    const tag = readString()
                    if (!Object.hasOwn(ValueSerialization, tag)) {throw new DecodeError("Unknown update primitive type")}
                    const type = tag as PrimitiveType
                    return new PrimitiveUpdate(address, ValueSerialization[type], readValue(type), readValue(type))
                }
                case "delete": {
                    requireBytes(16)
                    const uuid = UUID.fromDataInput(input)
                    const name = readString()
                    return new DeleteUpdate(uuid, name, readBytes().buffer)
                }
                default: throw new DecodeError("Unknown update type")
            }
        }
        const count = readLength(4)
        const updates: Update[] = []
        for (let index = 0; index < count; index++) {updates.push(readUpdate())}
        if (remaining() !== 0) {throw new DecodeError("Unconsumed update payload")}
        return updates
    }
}

interface Modification {
    forward(graph: BoxGraph): void
    inverse(graph: BoxGraph): void
    write(output: DataOutput): void
}

export class NewUpdate implements Modification {
    readonly type = "new"

    readonly #uuid: UUID.Bytes
    readonly #name: string
    readonly #settings: ArrayBufferLike

    constructor(uuid: UUID.Bytes, name: string, settings: ArrayBufferLike) {
        this.#uuid = uuid
        this.#name = name
        this.#settings = settings
    }

    get uuid(): UUID.Bytes {return this.#uuid}
    get name(): string {return this.#name}
    get settings(): ArrayBufferLike {return this.#settings}

    forward(graph: BoxGraph): void {
        graph.createBox(this.#name, this.#uuid, box => box.read(new ByteArrayInput(this.#settings)))
    }

    inverse(graph: BoxGraph): void {
        graph.findBox(this.#uuid).unwrap(() => `Could not find ${this.#name}`).unstage()
    }

    write(output: DataOutput): void {
        output.writeString(this.type)
        UUID.toDataOutput(output, this.#uuid)
        output.writeString(this.#name)
        output.writeInt(this.#settings.byteLength)
        output.writeBytes(new Int8Array(this.#settings))
    }

    toString(): string {
        return `{NewUpdate uuid: ${UUID.toString(this.#uuid)}, attachment: ${this.settings.byteLength}b`
    }

    toDebugString(_graph: BoxGraph): string {return this.toString()}
}

export type FieldUpdate = PrimitiveUpdate | PointerUpdate

export class PrimitiveUpdate<V extends PrimitiveValues = PrimitiveValues> implements Modification {
    readonly type = "primitive"

    readonly #address: Address
    readonly #serialization: ValueSerialization<V>
    readonly #oldValue: V
    readonly #newValue: V

    constructor(address: Address, serialization: ValueSerialization<V>, oldValue: V, newValue: V) {
        this.#address = address
        this.#serialization = serialization
        this.#oldValue = oldValue
        this.#newValue = newValue
    }

    get address(): Address {return this.#address}
    get oldValue(): V {return this.#oldValue}
    get newValue(): V {return this.#newValue}

    matches(field: PrimitiveField): boolean {return field.address.equals(this.address)}

    inverse(graph: BoxGraph): void {this.field(graph).setValue(this.#oldValue)}
    forward(graph: BoxGraph): void {this.field(graph).setValue(this.#newValue)}

    field(graph: BoxGraph): PrimitiveField<V> {
        return graph.findVertex(this.#address)
            .unwrap(() => `Could not find PrimitiveField at ${this.#address}`) as PrimitiveField<V>
    }

    write(output: DataOutput): void {
        output.writeString(this.type)
        this.#address.write(output)
        output.writeString(this.#serialization.type)
        this.#serialization.encode(output, this.#oldValue)
        this.#serialization.encode(output, this.#newValue)
    }

    toString(): string {
        return `{PrimitiveUpdate oldValue: ${this.#oldValue}, newValue: ${this.#newValue}`
    }
}

export class PointerUpdate implements Modification {
    readonly type = "pointer"

    readonly #address: Address
    readonly #oldAddress: Option<Address>
    readonly #newAddress: Option<Address>

    constructor(address: Address, oldAddress: Option<Address>, newAddress: Option<Address>) {
        this.#address = address
        this.#oldAddress = oldAddress
        this.#newAddress = newAddress
    }

    get address(): Address {return this.#address}
    get oldAddress(): Option<Address> {return this.#oldAddress}
    get newAddress(): Option<Address> {return this.#newAddress}

    matches(field: PointerField): boolean {return field.address.equals(this.address)}

    inverse(graph: BoxGraph): void {this.field(graph).targetAddress = this.#oldAddress}
    forward(graph: BoxGraph): void {this.field(graph).targetAddress = this.#newAddress}

    field(graph: BoxGraph): PointerField {
        return graph.findVertex(this.#address)
            .unwrap(() => `Could not find PointerField at ${this.#address}`) as PointerField
    }

    write(output: DataOutput): void {
        output.writeString(this.type)
        this.#address.write(output)
        this.#oldAddress.match({
            none: () => output.writeBoolean(false),
            some: address => {
                output.writeBoolean(true)
                address.write(output)
            }
        })
        this.#newAddress.match({
            none: () => output.writeBoolean(false),
            some: address => {
                output.writeBoolean(true)
                address.write(output)
            }
        })
    }

    toString(): string {
        return `{PointerUpdate oldValue: ${this.#oldAddress.unwrapOrNull()}, newValue: ${this.#newAddress.unwrapOrNull()}`
    }
}

export class DeleteUpdate implements Modification {
    readonly type = "delete"

    readonly #uuid: UUID.Bytes
    readonly #name: string
    readonly #settings: ArrayBufferLike

    constructor(uuid: UUID.Bytes, name: string, settings: ArrayBufferLike) {
        this.#uuid = uuid
        this.#name = name
        this.#settings = settings
    }

    get uuid(): UUID.Bytes {return this.#uuid}
    get name(): string {return this.#name}
    get settings(): ArrayBufferLike {return this.#settings}

    forward(graph: BoxGraph): void {
        graph.findBox(this.#uuid).unwrap(() => `Could not find ${this.#name}`).unstage()
    }

    inverse(graph: BoxGraph): void {
        graph.createBox(this.#name, this.#uuid, box => box.read(new ByteArrayInput(this.#settings)))
    }

    write(output: DataOutput): void {
        output.writeString(this.type)
        UUID.toDataOutput(output, this.#uuid)
        output.writeString(this.#name)
        output.writeInt(this.#settings.byteLength)
        output.writeBytes(new Int8Array(this.#settings))
    }

    toString(): string {
        return `{DeleteUpdate uuid: ${UUID.toString(this.#uuid)}, attachment: ${this.settings.byteLength}b`
    }
}