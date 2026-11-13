import {ByteArrayOutput, Maybe, Option, Procedure, UUID} from "@opendaw/lib-std"
import {Box} from "../box"
import {BoxGraph} from "../graph"
import {BooleanField, Float32Field, StringField} from "../primitive"
import {PointerField} from "../pointer"
import {NoPointers, VertexVisitor} from "../vertex"

export class TestBox extends Box<string, {0: BooleanField, 1: StringField, 2: PointerField<string>, 3: Float32Field}> {
    static create(graph: BoxGraph, uuid = UUID.generate(), init?: Procedure<TestBox>): TestBox {
        return graph.stageBox(new TestBox({graph, uuid, name: "TestBox", pointerRules: {accepts: ["test"], mandatory: false}}), init)
    }
    protected initializeFields() {
        const field = {parent: this, pointerRules: NoPointers, deprecated: false}
        return {
            0: BooleanField.create({...field, fieldKey: 0, fieldName: "flag"}),
            1: StringField.create({...field, fieldKey: 1, fieldName: "text"}),
            2: PointerField.create({...field, fieldKey: 2, fieldName: "ref"}, "test", false),
            3: Float32Field.create({...field, fieldKey: 3, fieldName: "level"}, "any", "")
        }
    }
    get tags(): Readonly<Record<string, string | number | boolean>> {return {}}
    accept<R>(_visitor: VertexVisitor<R>): Maybe<R> {return undefined}
}
export const graph = (): BoxGraph => new BoxGraph(Option.wrap((_name, graph, uuid, init) => TestBox.create(graph, uuid, init)))
export const fields = (entries: Array<[number, ArrayBufferLike]>): ArrayBufferLike => {
    const out = ByteArrayOutput.create()
    out.writeInt(0x464c4453)
    out.writeShort(entries.length)
    for (const [key, bytes] of entries) {
        out.writeShort(key)
        out.writeInt(bytes.byteLength)
        out.writeBytes(new Int8Array(bytes))
    }
    return out.toArrayBuffer()
}
export const project = (...records: Array<ArrayBufferLike>): ArrayBufferLike => {
    const out = ByteArrayOutput.create()
    out.writeInt(records.length)
    for (const record of records) {
        const box = ByteArrayOutput.create()
        box.writeInt(0)
        box.writeString("TestBox")
        box.writeBytes(new Int8Array(UUID.generate()))
        box.writeBytes(new Int8Array(record))
        const buffer = box.toArrayBuffer()
        out.writeInt(buffer.byteLength)
        out.writeBytes(new Int8Array(buffer))
    }
    return out.toArrayBuffer()
}
