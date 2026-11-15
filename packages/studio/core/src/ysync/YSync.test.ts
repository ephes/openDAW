import {beforeEach, describe, expect, it, vi} from "vitest"
import * as Y from "yjs"
import {Maybe, Option, panic, Procedure, safeExecute, UUID} from "@opendaw/lib-std"
import {
    Box,
    BoxConstruct,
    BoxGraph,
    BooleanField,
    Int32Field,
    NoPointers,
    PointerField,
    StringField,
    UnreferenceableType,
    VertexVisitor
} from "@opendaw/lib-box"
import {YSync} from "./YSync"
import {YMapper} from "./YMapper"

// --- Minimal box fixtures ------------------------------------------------

enum Pointer {Target}

interface TestVisitor<RETURN = void> extends VertexVisitor<RETURN> {
    visitLeafBox?(box: LeafBox): RETURN
    visitRefBox?(box: RefBox): RETURN
}

type LeafBoxFields = {
    1: Int32Field
    2: StringField
    3: BooleanField
}

class LeafBox extends Box<Pointer.Target, LeafBoxFields> {
    static create(graph: BoxGraph, uuid: UUID.Bytes, constructor?: Procedure<LeafBox>): LeafBox {
        return graph.stageBox(new LeafBox({
            uuid, graph, name: "LeafBox",
            pointerRules: {accepts: [Pointer.Target], mandatory: false, exclusive: false}
        }), constructor)
    }

    private constructor(construct: BoxConstruct<Pointer.Target>) {super(construct)}

    protected initializeFields(): LeafBoxFields {
        return {
            1: Int32Field.create(
                {parent: this, fieldKey: 1, fieldName: "count", deprecated: false, pointerRules: NoPointers},
                "any", "none"),
            2: StringField.create(
                {parent: this, fieldKey: 2, fieldName: "label", deprecated: false, pointerRules: NoPointers}),
            3: BooleanField.create(
                {parent: this, fieldKey: 3, fieldName: "flag", deprecated: false, pointerRules: NoPointers},
                false)
        }
    }

    accept<R>(visitor: TestVisitor<R>): Maybe<R> {return safeExecute(visitor.visitLeafBox, this)}
    get tags(): Readonly<Record<string, string | number | boolean>> {return {}}
    get count(): Int32Field {return this.getField(1)}
    get label(): StringField {return this.getField(2)}
    get flag(): BooleanField {return this.getField(3)}
}

type RefBoxFields = {
    1: PointerField<Pointer.Target>
}

class RefBox extends Box<UnreferenceableType, RefBoxFields> {
    static create(graph: BoxGraph, uuid: UUID.Bytes, constructor?: Procedure<RefBox>): RefBox {
        return graph.stageBox(new RefBox({uuid, graph, name: "RefBox", pointerRules: NoPointers}), constructor)
    }

    private constructor(construct: BoxConstruct<UnreferenceableType>) {super(construct)}

    protected initializeFields(): RefBoxFields {
        return {
            1: PointerField.create(
                {parent: this, fieldKey: 1, fieldName: "target", deprecated: false, pointerRules: NoPointers},
                Pointer.Target, false)
        }
    }

    accept<R>(visitor: TestVisitor<R>): Maybe<R> {return safeExecute(visitor.visitRefBox, this)}
    get tags(): Readonly<Record<string, string | number | boolean>> {return {}}
    get target(): PointerField<Pointer.Target> {return this.getField(1)}
}

const factory = (name: string, graph: BoxGraph, uuid: UUID.Bytes, constructor: Procedure<Box>): Box => {
    switch (name) {
        case "LeafBox":
            return LeafBox.create(graph, uuid, constructor as Procedure<LeafBox>)
        case "RefBox":
            return RefBox.create(graph, uuid, constructor as Procedure<RefBox>)
        default:
            return panic(`Unknown box: ${name}`)
    }
}

// --- Scene ---------------------------------------------------------------

interface Scene {
    doc: Y.Doc
    boxes: Y.Map<unknown>
    graph: BoxGraph
    sync: YSync<unknown>
}

const makeScene = async (): Promise<Scene> => {
    const doc = new Y.Doc()
    const boxes = doc.getMap("boxes")
    const graph = new BoxGraph<Record<string, Box>>(Option.wrap(factory))
    const sync = await YSync.populateRoom<Record<string, Box>>({boxGraph: graph, boxes})
    return {doc, boxes, graph, sync}
}

const beginCommit = (graph: BoxGraph, fn: () => void): void => {
    graph.beginTransaction()
    try {
        fn()
    } finally {
        graph.endTransaction()
    }
}

// --- Tests ---------------------------------------------------------------

describe("YSync.flush", () => {
    let scene: Scene

    beforeEach(async () => {
        scene = await makeScene()
    })

    it("writes new boxes, primitives, and pointers into yjs", () => {
        let leafId: UUID.Bytes | undefined
        let refId: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const leaf = LeafBox.create(scene.graph, UUID.generate())
            leaf.count.setValue(42)
            leaf.label.setValue("hello")
            leaf.flag.setValue(true)
            const ref = RefBox.create(scene.graph, UUID.generate())
            ref.target.refer(leaf)
            leafId = leaf.address.uuid
            refId = ref.address.uuid
        })

        expect(scene.boxes.size).toBe(2)

        const leafMap = scene.boxes.get(UUID.toString(leafId!)) as Y.Map<unknown>
        expect(leafMap.get("name")).toBe("LeafBox")
        const leafFields = leafMap.get("fields") as Y.Map<unknown>
        expect(leafFields).toBeInstanceOf(Y.Map)
        expect(leafFields.get("1")).toBe(42)
        expect(leafFields.get("2")).toBe("hello")
        expect(leafFields.get("3")).toBe(true)

        const refMap = scene.boxes.get(UUID.toString(refId!)) as Y.Map<unknown>
        const refFields = refMap.get("fields") as Y.Map<unknown>
        expect(typeof refFields.get("1")).toBe("string")
    })

    it("drops phantom boxes created and deleted in the same transaction", () => {
        let phantomId: UUID.Bytes | undefined
        let survivorId: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const phantom = LeafBox.create(scene.graph, UUID.generate())
            phantom.count.setValue(7)
            phantomId = phantom.address.uuid
            phantom.delete()
            const survivor = LeafBox.create(scene.graph, UUID.generate())
            survivor.label.setValue("keep")
            survivorId = survivor.address.uuid
        })

        expect(scene.boxes.has(UUID.toString(phantomId!))).toBe(false)
        expect(scene.boxes.has(UUID.toString(survivorId!))).toBe(true)
        const survivorMap = scene.boxes.get(UUID.toString(survivorId!)) as Y.Map<unknown>
        const fields = survivorMap.get("fields") as Y.Map<unknown>
        expect(fields.get("2")).toBe("keep")
    })

    it("updates mutable fields on existing boxes", () => {
        let uuid: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const leaf = LeafBox.create(scene.graph, UUID.generate())
            leaf.count.setValue(1)
            uuid = leaf.address.uuid
        })

        const leaf = scene.graph.findBox<LeafBox>(uuid!).unwrap()
        beginCommit(scene.graph, () => {
            leaf.count.setValue(99)
            leaf.flag.setValue(true)
        })

        const map = scene.boxes.get(UUID.toString(uuid!)) as Y.Map<unknown>
        const fields = map.get("fields") as Y.Map<unknown>
        expect(fields.get("1")).toBe(99)
        expect(fields.get("3")).toBe(true)
    })

    it("drains the queue even if a later flush throws", () => {
        // First commit succeeds and establishes the box in yjs.
        let uuid: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const leaf = LeafBox.create(scene.graph, UUID.generate())
            leaf.label.setValue("initial")
            uuid = leaf.address.uuid
        })
        expect(scene.boxes.has(UUID.toString(uuid!))).toBe(true)

        // Simulate drift: wipe the "fields" sub-map of the stored box so the next
        // pointer/primitive update cannot traverse into it.
        const map = scene.boxes.get(UUID.toString(uuid!)) as Y.Map<unknown>
        map.delete("fields")

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        try {
            // This used to throw a TypeError inside transact and leave #updates populated.
            expect(() => beginCommit(scene.graph, () => {
                const leaf = scene.graph.findBox<LeafBox>(uuid!).unwrap()
                leaf.label.setValue("second")
            })).not.toThrow()
            expect(warn).toHaveBeenCalled()
        } finally {
            warn.mockRestore()
        }

        // A subsequent transaction must still be able to flush cleanly.
        let secondId: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const next = LeafBox.create(scene.graph, UUID.generate())
            next.label.setValue("third")
            secondId = next.address.uuid
        })
        expect(scene.boxes.has(UUID.toString(secondId!))).toBe(true)
        const nextMap = scene.boxes.get(UUID.toString(secondId!)) as Y.Map<unknown>
        const nextFields = nextMap.get("fields") as Y.Map<unknown>
        expect(nextFields.get("2")).toBe("third")
    })

    it("clears pending updates on aborted/rolled-back transactions", () => {
        // Stage work then abort; the pending queue must not leak into the next tx.
        scene.graph.beginTransaction()
        LeafBox.create(scene.graph, UUID.generate()).count.setValue(123)
        scene.graph.abortTransaction()

        expect(scene.boxes.size).toBe(0)

        let uuid: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const leaf = LeafBox.create(scene.graph, UUID.generate())
            leaf.label.setValue("fresh")
            uuid = leaf.address.uuid
        })
        expect(scene.boxes.size).toBe(1)
        const map = scene.boxes.get(UUID.toString(uuid!)) as Y.Map<unknown>
        const fields = map.get("fields") as Y.Map<unknown>
        expect(fields.get("2")).toBe("fresh")
    })

    it("mirrors the crash scenario: create + mutate + cascade-delete in one transaction", () => {
        // A close analogue of report #920: a newly-created box is mutated and, in
        // the same transaction, another existing box is deleted (defer + unstage).
        // The queue contains New, Pointer, Primitive and Delete updates; a missing
        // "fields" sub-map on the box being deleted used to take down the whole
        // transact callback. With the fix, the flush must still complete and leave
        // the yjs state consistent with the graph.
        let survivorId: UUID.Bytes | undefined
        let oldLeafId: UUID.Bytes | undefined

        // Pre-existing state.
        beginCommit(scene.graph, () => {
            const oldLeaf = LeafBox.create(scene.graph, UUID.generate())
            oldLeaf.label.setValue("old")
            oldLeafId = oldLeaf.address.uuid
        })

        // Intentionally corrupt the stored box to provoke the broken-fields path.
        const leafMap = scene.boxes.get(UUID.toString(oldLeafId!)) as Y.Map<unknown>
        leafMap.delete("fields")

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        try {
            beginCommit(scene.graph, () => {
                const newLeaf = LeafBox.create(scene.graph, UUID.generate())
                newLeaf.label.setValue("survivor")
                survivorId = newLeaf.address.uuid

                const ref = RefBox.create(scene.graph, UUID.generate())
                ref.target.refer(newLeaf)

                scene.graph.findBox<LeafBox>(oldLeafId!).unwrap().delete()
            })
        } finally {
            warn.mockRestore()
        }

        // Old leaf is gone, new leaf is present with all fields.
        expect(scene.boxes.has(UUID.toString(oldLeafId!))).toBe(false)
        const survivorMap = scene.boxes.get(UUID.toString(survivorId!)) as Y.Map<unknown>
        expect(survivorMap).toBeInstanceOf(Y.Map)
        const survivorFields = survivorMap.get("fields") as Y.Map<unknown>
        expect(survivorFields.get("2")).toBe("survivor")

        // Graph and yjs agree on box count.
        expect(scene.boxes.size).toBe(scene.graph.boxes().length)
    })

    it("tolerates a pointer update whose field path is broken mid-way", () => {
        let refId: UUID.Bytes | undefined
        let leafId: UUID.Bytes | undefined
        beginCommit(scene.graph, () => {
            const leaf = LeafBox.create(scene.graph, UUID.generate())
            const ref = RefBox.create(scene.graph, UUID.generate())
            ref.target.refer(leaf)
            refId = ref.address.uuid
            leafId = leaf.address.uuid
        })

        const refMap = scene.boxes.get(UUID.toString(refId!)) as Y.Map<unknown>
        const refFields = refMap.get("fields") as Y.Map<unknown>
        // Pretend the pointer slot was swapped to a non-map value (drift).
        refFields.set("1", "garbage")

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        try {
            expect(() => beginCommit(scene.graph, () => {
                const ref = scene.graph.findBox<RefBox>(refId!).unwrap()
                ref.target.defer()
            })).not.toThrow()
        } finally {
            warn.mockRestore()
        }

        expect(scene.graph.findBox(leafId!).nonEmpty()).toBe(true)
    })
})

const copyDoc = (source: Y.Doc): Y.Doc => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source))
    return doc
}
const graphForJoin = () => new BoxGraph<Record<string, Box>>(Option.wrap(factory))
const exchange = (source: Y.Doc, target: Y.Doc) => Y.applyUpdate(target, Y.encodeStateAsUpdate(source))

describe("YSync conflict admission", () => {
    it.each(["constructor", "populate", "join"])("retains the %s conflict provider", async mode => {
        const source = await makeScene()
        const doc = copyDoc(source.doc)
        const graph = graphForJoin()
        const conflict = vi.fn(() => false)
        const construct = {boxGraph: graph, boxes: doc.getMap("boxes"), conflict}
        const sync = mode === "constructor" ? new YSync(construct)
            : mode === "populate" ? await YSync.populateRoom(construct) : await YSync.joinRoom(construct)
        beginCommit(source.graph, () => LeafBox.create(source.graph, UUID.generate()))
        exchange(source.doc, doc)
        expect(conflict).toHaveBeenCalledOnce()
        expect(graph.boxes()).toHaveLength(1)
        sync.terminate()
    })

    it.each(["primitive", "add", "delete"])("reverts a conflicting %s on both peers", async kind => {
        const source = await makeScene()
        let leaf!: LeafBox
        beginCommit(source.graph, () => {leaf = LeafBox.create(source.graph, UUID.generate()); leaf.count.setValue(1)})
        const doc = copyDoc(source.doc)
        const graph = graphForJoin()
        beginCommit(graph, () => LeafBox.create(graph, leaf.address.uuid, box => box.count.setValue(1)))
        const sync = new YSync({boxGraph: graph, boxes: doc.getMap("boxes"), conflict: () =>
            graph.boxes().length !== 1 || graph.findBox<LeafBox>(leaf.address.uuid).mapOr(box => box.count.getValue() > 1, true)})
        const before = doc.getMap("boxes").toJSON()
        beginCommit(source.graph, () => {
            if (kind === "primitive") {leaf.count.setValue(2)}
            if (kind === "add") {LeafBox.create(source.graph, UUID.generate())}
            if (kind === "delete") {leaf.delete()}
        })
        exchange(source.doc, doc)
        exchange(doc, source.doc)
        expect(graph.inTransaction()).toBe(false)
        expect(graph.boxes()).toHaveLength(1)
        expect(graph.findBox<LeafBox>(leaf.address.uuid).unwrap().count.getValue()).toBe(1)
        expect(doc.getMap("boxes").toJSON()).toEqual(before)
        expect(source.doc.getMap("boxes").toJSON()).toEqual(before)
        expect(source.graph.findBox<LeafBox>(leaf.address.uuid).unwrap().count.getValue()).toBe(1)
        sync.terminate()
    })
})

describe("YSync join ownership", () => {
    it.each(["uuid", "type"])("unwinds a malformed later %s and allows retry", async invalid => {
        const source = await makeScene()
        beginCommit(source.graph, () => LeafBox.create(source.graph, UUID.generate()))
        const badKey = invalid === "uuid" ? "invalid" : UUID.toString(UUID.generate())
        source.boxes.set(badKey, new Y.Map<unknown>([["name", "UnknownBox"], ["fields", new Y.Map<unknown>()]]))
        const graph = graphForJoin()
        const unobserve = vi.spyOn(source.boxes, "unobserveDeep")
        await expect(YSync.joinRoom({boxGraph: graph, boxes: source.boxes})).rejects.toThrow()
        expect(graph.inTransaction()).toBe(false)
        expect(graph.boxes()).toHaveLength(0)
        expect(unobserve).toHaveBeenCalledOnce()
        source.boxes.delete(badKey)
        const sync = await YSync.joinRoom({boxGraph: graph, boxes: source.boxes})
        expect(graph.boxes()).toHaveLength(1)
        sync.terminate()
    })

    it("preserves shared map identities and extensions without a bootstrap update", async () => {
        const source = await makeScene()
        let leaf!: LeafBox
        beginCommit(source.graph, () => {leaf = LeafBox.create(source.graph, UUID.generate())})
        const doc = copyDoc(source.doc)
        const boxes = doc.getMap("boxes")
        const map = boxes.get(UUID.toString(leaf.address.uuid)) as Y.Map<unknown>
        map.set("extension", "preserve")
        const fields = map.get("fields")
        const update = vi.fn()
        doc.on("update", update)
        const graph = graphForJoin()
        const sync = await YSync.joinRoom({boxGraph: graph, boxes})
        expect(update).not.toHaveBeenCalled()
        expect(boxes.get(UUID.toString(leaf.address.uuid))).toBe(map)
        expect(map.get("fields")).toBe(fields)
        expect(map.get("extension")).toBe("preserve")
        beginCommit(graph, () => graph.findBox<LeafBox>(leaf.address.uuid).unwrap().count.setValue(7))
        expect(update).toHaveBeenCalledOnce()
        expect((fields as Y.Map<unknown>).get("1")).toBe(7)
        sync.terminate()
    })
})

describe("YSync remote identity", () => {
    it("applies same-type root replacement including pointer fields", async () => {
        const source = await makeScene()
        let a!: LeafBox, b!: LeafBox, ref!: RefBox
        beginCommit(source.graph, () => {
            a = LeafBox.create(source.graph, UUID.generate())
            b = LeafBox.create(source.graph, UUID.generate())
            ref = RefBox.create(source.graph, UUID.generate(), box => box.target.refer(a))
        })
        const doc = copyDoc(source.doc)
        const graph = graphForJoin()
        const sync = await YSync.joinRoom({boxGraph: graph, boxes: doc.getMap("boxes")})
        source.doc.transact(() => {
            source.boxes.set(UUID.toString(a.address.uuid), new Y.Map<unknown>([
                ["name", "LeafBox"], ["fields", new Y.Map<unknown>([["1", 9], ["2", "replacement"], ["3", false]])]
            ]))
            source.boxes.set(UUID.toString(ref.address.uuid), new Y.Map<unknown>([
                ["name", "RefBox"], ["fields", new Y.Map<unknown>([["1", b.address.toString()]])]
            ]))
        })
        exchange(source.doc, doc)
        expect(graph.findBox<LeafBox>(a.address.uuid).unwrap().count.getValue()).toBe(9)
        expect(graph.findBox<LeafBox>(a.address.uuid).unwrap().label.getValue()).toBe("replacement")
        expect(graph.findBox<RefBox>(ref.address.uuid).unwrap().target.targetAddress.unwrap().equals(b.address)).toBe(true)
        sync.terminate()
    })

    it("refuses an incompatible box type and restores the previous shared map", async () => {
        const source = await makeScene()
        let leaf!: LeafBox
        beginCommit(source.graph, () => {leaf = LeafBox.create(source.graph, UUID.generate())})
        const doc = copyDoc(source.doc)
        const graph = graphForJoin()
        const sync = await YSync.joinRoom({boxGraph: graph, boxes: doc.getMap("boxes")})
        const before = doc.getMap("boxes").toJSON()
        source.boxes.set(UUID.toString(leaf.address.uuid), new Y.Map<unknown>([
            ["name", "RefBox"], ["fields", new Y.Map<unknown>([["1", null]])]
        ]))
        exchange(source.doc, doc)
        expect(graph.findBox(leaf.address.uuid).unwrap()).toBeInstanceOf(LeafBox)
        expect(doc.getMap("boxes").toJSON()).toEqual(before)
        sync.terminate()
    })

    it.each(["65536", "0.5", "", "NaN", "01", "+1", "-0", "32768", "-32769"])("refuses noncanonical/out-of-domain field %j", key => {
        expect(() => YMapper.pathToAddress([UUID.toString(UUID.generate()), "fields"], key)).toThrow()
    })
    it("checks the fields marker and preserves legal signed i16 keys", () => {
        const uuid = UUID.toString(UUID.generate())
        expect(() => YMapper.pathToAddress([uuid, "wrong"], "0")).toThrow()
        expect(Array.from(YMapper.pathToAddress([uuid, "fields", "-32768"], "32767").fieldKeys)).toEqual([-32768, 32767])
    })
})

describe("YSync populate ownership", () => {
    it("prepares every detached map before publishing and retires failed setup", async () => {
        const graph = graphForJoin()
        beginCommit(graph, () => {
            LeafBox.create(graph, UUID.generate())
            LeafBox.create(graph, UUID.generate())
        })
        const doc = new Y.Doc()
        const boxes = doc.getMap("boxes")
        const unobserve = vi.spyOn(boxes, "unobserveDeep")
        const original = YMapper.createBoxMap
        const mapping = vi.spyOn(YMapper, "createBoxMap")
            .mockImplementationOnce(original).mockImplementationOnce(() => {throw new Error("serialization")})
        await expect(YSync.populateRoom({boxGraph: graph, boxes})).rejects.toThrow("serialization")
        mapping.mockRestore()
        expect(boxes.size).toBe(0)
        expect(unobserve).toHaveBeenCalledOnce()
        beginCommit(graph, () => LeafBox.create(graph, UUID.generate()))
        expect(boxes.size).toBe(0)
        const updates = vi.fn()
        doc.on("update", updates)
        const sync = await YSync.populateRoom({boxGraph: graph, boxes})
        expect(boxes.size).toBe(3)
        expect(updates).toHaveBeenCalledOnce()
        sync.terminate()
    })
})

it("evaluates conflict policy with finalized pointer hubs and bounds live inverse exchange", async () => {
    const source = await makeScene()
    let leaf!: LeafBox, ref!: RefBox
    beginCommit(source.graph, () => {
        leaf = LeafBox.create(source.graph, UUID.generate())
        ref = RefBox.create(source.graph, UUID.generate())
    })
    const doc = copyDoc(source.doc)
    const graph = graphForJoin()
    const sync = await YSync.joinRoom({boxGraph: graph, boxes: doc.getMap("boxes"),
        conflict: () => graph.findBox<LeafBox>(leaf.address.uuid).unwrap().incomingEdges().length > 0})
    let transmissions = 0
    const forward = (target: Y.Doc) => (update: Uint8Array) => {
        expect(++transmissions).toBeLessThan(8)
        Y.applyUpdate(target, update)
    }
    source.doc.on("update", forward(doc))
    doc.on("update", forward(source.doc))
    beginCommit(source.graph, () => ref.target.refer(leaf))
    expect(graph.findBox<RefBox>(ref.address.uuid).unwrap().target.targetAddress.isEmpty()).toBe(true)
    expect(ref.target.targetAddress.isEmpty()).toBe(true)
    expect(doc.getMap("boxes").toJSON()).toEqual(source.boxes.toJSON())
    sync.terminate()
    source.sync.terminate()
    doc.destroy()
    source.doc.destroy()
})
