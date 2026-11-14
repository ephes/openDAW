import {describe, expect, it, vi} from "vitest"
import {ByteArrayOutput, ByteCounter, JSONValue, Maybe, Option, Procedure, UUID} from "@opendaw/lib-std"
import {Serializer} from "./serializer"
import {Box} from "./box"
import {ArrayField} from "./array"
import {BoxGraph} from "./graph"
import {BoxEditing} from "./editing"
import {PointerField} from "./pointer"
import {NoPointers, VertexVisitor} from "./vertex"
import {graph, TestBox} from "./testing/fixtures"
import {ObjectField} from "./object"
import {FieldConstruct} from "./field"
import {UnreferenceableType} from "./pointer"
import {BooleanField, StringField} from "./primitive"

class ArrayBox extends Box<string, {0: ArrayField<PointerField<string>>}> {
    static create(graph: BoxGraph, uuid = UUID.generate(), init?: Procedure<ArrayBox>): ArrayBox {
        return graph.stageBox(new ArrayBox({graph, uuid, name: "ArrayBox", pointerRules: {accepts: ["test"], mandatory: false}}), init)
    }
    protected initializeFields() {
        return {0: ArrayField.create({parent: this, fieldKey: 0, fieldName: "refs", pointerRules: NoPointers, deprecated: false},
            construct => PointerField.create(construct, "test", false), 2)}
    }
    get tags(): Readonly<Record<string, string | number | boolean>> {return {}}
    accept<R>(visitor: VertexVisitor<R>): Maybe<R> {void visitor; return undefined}
}

type NestedFields = {0: BooleanField, 1: StringField}
class NestedObject extends ObjectField<NestedFields> {
    constructor(construct: FieldConstruct<UnreferenceableType>) {super(construct)}
    protected initializeFields(): NestedFields {
        const field = {parent: this, pointerRules: NoPointers, deprecated: false}
        return {0: BooleanField.create({...field, fieldKey: 0, fieldName: "flag"}),
            1: StringField.create({...field, fieldKey: 1, fieldName: "text"})}
    }
}
class NestedBox extends Box<string, {0: NestedObject}> {
    static create(graph: BoxGraph, uuid = UUID.generate(), init?: Procedure<NestedBox>): NestedBox {
        return graph.stageBox(new NestedBox({graph, uuid, name: "NestedBox", pointerRules: {accepts: ["test"], mandatory: false}}), init)
    }
    protected initializeFields() {
        return {0: new NestedObject({parent: this, fieldKey: 0, fieldName: "nested", pointerRules: NoPointers, deprecated: false})}
    }
    get tags(): Readonly<Record<string, string | number | boolean>> {return {}}
    accept<R>(visitor: VertexVisitor<R>): Maybe<R> {void visitor; return undefined}
}

describe("JSON import admission", () => {
    it.each([{"1": "changed", "1junk": "alias"}, {"1": "changed", "99": true}, {"01": "alias"}, {"1.0": "alias"}])(
        "preflights all nested object keys before changing values: %j", record => {
            const target = graph()
            const editing = new BoxEditing(target)
            const box = editing.modify(() => NestedBox.create(target, UUID.generate(),
                box => box.getField(0).getField(1).setValue("retained"))).unwrap()
            const original = box.toJSON()
            target.beginTransaction()
            expect(() => box.getField(0).fromJSON(record)).toThrow(/Unsupported JSON field key/)
            expect(box.toJSON()).toEqual(original)
            target.abortTransaction()
            editing.modify(() => box.getField(0).fromJSON({"0": true, "1": "valid"}))
            expect(box.getField(0).getField(1).getValue()).toBe("valid")
        })

    it.each([{"1": "changed", "1junk": "alias"}, {"1": "changed", "99": true},
        {"01": "alias"}, {"+1": "alias"}, {"1.0": "alias"}, {"-0": true}, {"32768": true}])(
        "preflights all box keys before changing values: %j", record => {
            const target = graph()
            const editing = new BoxEditing(target)
            const box = editing.modify(() => TestBox.create(target, UUID.generate(), box => box.getField(1).setValue("retained"))).unwrap()
            const original = box.toJSON()
            target.beginTransaction()
            expect(() => box.fromJSON(record)).toThrow()
            expect(box.toJSON()).toEqual(original)
            target.abortTransaction()
            editing.modify(() => box.fromJSON({"0": true, "1": "valid"}))
            expect(box.getField(1).getValue()).toBe("valid")
            editing.undo()
            expect(box.toJSON()).toEqual(original)
        })

    it("rolls back a failing graph JSON import and keeps the graph editable", () => {
        const target = graph()
        const editing = new BoxEditing(target)
        editing.modify(() => TestBox.create(target))
        const original = target.toJSON()
        const imported = {
            [UUID.toString(UUID.generate())]: {name: "TestBox", fields: {"0": true}},
            [UUID.toString(UUID.generate())]: {name: "TestBox", fields: {"1": "partial", "99": true}}
        }
        expect(() => target.fromJSON(imported)).toThrow()
        expect(target.toJSON()).toEqual(original)
        expect(target.inTransaction()).toBe(false)
        const next = editing.modify(() => TestBox.create(target)).unwrap()
        editing.modify(() => next.getField(0).setValue(true))
        expect(next.getField(0).getValue()).toBe(true)
    })
})

describe("fixed array JSON preflight", () => {
    const setup = () => {
        const target = new BoxGraph(Option.wrap((_name, graph, uuid, init) => ArrayBox.create(graph, uuid, init)))
        const editing = new BoxEditing(target)
        const box = editing.modify(() => ArrayBox.create(target)).unwrap()
        editing.modify(() => box.getField(0).fields().forEach(field => field.refer(box)))
        return {target, editing, box}
    }
    it.each(([ [null], [null, null, null], {}, "bad", new Array(2)] as Array<JSONValue>).map(values => ({values})))(
        "rejects a wrong shape before changing any array elements: %j", ({values}) => {
            const {target, box} = setup()
            const original = box.toJSON()
            target.beginTransaction()
            expect(() => box.getField(0).fromJSON(values)).toThrow()
            expect(box.toJSON()).toEqual(original)
            target.abortTransaction()
        })
    it("rolls back a child failure and round-trips exact arrays through undo", () => {
        const {target, editing, box} = setup()
        const original = box.toJSON()
        expect(() => editing.modify(() => box.getField(0).fromJSON([null, 42]))).toThrow()
        expect(box.toJSON()).toEqual(original)
        expect(target.inTransaction()).toBe(false)
        editing.modify(() => box.getField(0).fromJSON([null, null]))
        expect(box.getField(0).toJSON()).toEqual([null, null])
        editing.undo()
        expect(box.toJSON()).toEqual(original)
        const copy = new BoxGraph(Option.wrap((_name, graph, uuid, init) => ArrayBox.create(graph, uuid, init)))
        copy.fromJSON(target.toJSON())
        expect(copy.toJSON()).toEqual(target.toJSON())
    })
    it("rolls back malformed child arrays through the graph import boundary", () => {
        const {target, box} = setup()
        const original = target.toJSON()
        const record = {[UUID.toString(UUID.generate())]: {name: "ArrayBox", fields: {"0": [null, 42]}}}
        expect(() => target.fromJSON(record)).toThrow()
        expect(target.toJSON()).toEqual(original)
        expect(target.edges().incomingEdgesOf(box)).toHaveLength(2)
        expect(target.inTransaction()).toBe(false)
    })
})

describe("nested frame counting", () => {
    it("counts each nested field once and matches the written frame length", () => {
        const target = graph()
        target.beginTransaction()
        const box = NestedBox.create(target, UUID.generate(), box => box.getField(0).getField(1).setValue("synthetic"))
        target.endTransaction()
        const leaf = box.getField(0).getField(1)
        const write = vi.spyOn(leaf, "write")
        const counter = new ByteCounter()
        Serializer.writeFields(counter, {0: box.getField(0)})
        expect(write).toHaveBeenCalledTimes(1)
        write.mockClear()
        const output = ByteArrayOutput.create()
        Serializer.writeFields(output, {0: box.getField(0)})
        expect(output.position).toBe(counter.count)
        expect(write).toHaveBeenCalledTimes(3)
        vi.restoreAllMocks()
    })
})
