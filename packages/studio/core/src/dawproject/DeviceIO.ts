import {assert, ByteArrayInput, ByteArrayOutput, Option, panic, UUID} from "@opendaw/lib-std"
import {Address, Box, BoxGraph, Field, PointerField} from "@opendaw/lib-box"
import {BoxIO, TrackBox} from "@opendaw/studio-boxes"
import {DeviceBox, DeviceBoxUtils} from "@opendaw/studio-adapters"

export namespace DeviceIO {
    const LegacyAttachments: ReadonlySet<string> = new Set<keyof BoxIO.TypeMap>([
        "SelectionBox", "MIDIControllerBox", "TrackBox", "ValueRegionBox", "ValueEventCollectionBox"
    ])

    export const exportDevice = (box: Box): ArrayBufferLike => {
        // Selections, controller mappings and automation lanes refer to the device but are not its state.
        const dependencies = Array.from(box.graph.dependenciesOf(box, {
            excludeBox: dependency => dependency.ephemeral || dependency instanceof TrackBox
        }).boxes)

        const output = ByteArrayOutput.create()
        output.writeString("openDAW:device")
        output.writeInt(1) // format version
        const writeBox = (box: Box) => {
            UUID.toDataOutput(output, box.address.uuid)
            output.writeString(box.name)
            const arrayBuffer = box.toArrayBuffer()
            output.writeInt(arrayBuffer.byteLength)
            output.writeBytes(new Int8Array(arrayBuffer))
        }
        writeBox(box)
        output.writeInt(dependencies.length)
        dependencies.forEach(dep => writeBox(dep))
        return output.toArrayBuffer()
    }

    export const importDevice = (boxGraph: BoxGraph<BoxIO.TypeMap>, buffer: ArrayBufferLike, host: Field): DeviceBox => {
        const input = new ByteArrayInput(buffer)
        const header = input.readString()
        const version = input.readInt()
        assert(header === "openDAW:device", `wrong header: ${header}`)
        assert(version === 1, `wrong version: ${version}`)
        const mapping = UUID.newSet<{ source: UUID.Bytes, target: UUID.Bytes }>(({source}) => source)
        type RawBox = { uuid: UUID.Bytes, key: keyof BoxIO.TypeMap, input: ByteArrayInput }
        const rawBoxes: Array<RawBox> = []
        const readRawBox = (): RawBox => {
            const uuid = UUID.fromDataInput(input)
            const key = input.readString() as keyof BoxIO.TypeMap
            const length = input.readInt()
            assert(length >= 0 && length <= buffer.byteLength - input.position, "Invalid native device record length")
            const array = new Int8Array(length)
            input.readBytes(array)
            mapping.add({source: uuid, target: UUID.generate()})
            return {uuid, key, input: new ByteArrayInput(array.buffer)}
        }
        rawBoxes.push(readRawBox())
        const numDeps = input.readInt()
        assert(numDeps >= 0 && numDeps <= buffer.byteLength - input.position, "Invalid native device dependency count")
        const dependencies = Array.from({length: numDeps}, readRawBox)
        // Earlier exports also wrote selections, controller mappings and empty automation lanes that refer
        // to the device. They are not device state and are dropped. Dependent resources, cross-device state
        // and automation events need a dedicated import path.
        assert(input.position === buffer.byteLength
            && dependencies.every(({key}) => LegacyAttachments.has(key)),
        "Unsupported native device dependencies: render or remove dependent resources before interchange")
        // We are going to award all boxes with new UUIDs.
        // Therefore, we need to map all internal pointer targets.
        return PointerField.decodeWith({
            map: (pointer: PointerField, newAddress: Option<Address>): Option<Address> => {
                if (DeviceBoxUtils.isDeviceBox(pointer.box) && pointer === pointer.box.host) {
                    return Option.wrap(host.address)
                }
                return newAddress.map(address => mapping.opt(address.uuid).match({
                    none: () => panic("Unsupported native device external pointer"),
                    some: ({target}) => address.moveTo(target)
                }))
            }
        }, () => {
            const [main] = rawBoxes
            const {key, uuid, input} = main
            const box = boxGraph.createBox(key, mapping.get(uuid).target, box => box.read(input))
            if (!DeviceBoxUtils.isDeviceBox(box)) {return panic(`${box.name} is not a DeviceBox`)}
            assert(input.remaining() === 0, "Trailing native device state")
            box.host.refer(host)
            return box
        })
    }
}