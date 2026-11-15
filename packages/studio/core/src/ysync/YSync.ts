import {
    asDefined,
    asInstanceOf,
    assert,
    EmptyExec,
    isInstanceOf,
    JSONValue,
    Option,
    panic,
    Provider,
    Subscription,
    Terminable,
    Terminator,
    tryCatch,
    UUID
} from "@opendaw/lib-std"
import {
    ArrayField,
    BoxGraph,
    Field,
    ObjectField,
    optimizeUpdates,
    PointerField,
    PrimitiveField,
    Update
} from "@opendaw/lib-box"
import {YMapper} from "./YMapper"
import * as Y from "yjs"

type EventHandler = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, transaction: Y.Transaction) => void

export type Construct<T> = {
    boxGraph: BoxGraph<T>,
    boxes: Y.Map<unknown>
    conflict?: Provider<boolean>
}

export class YSync<T> implements Terminable {
    static debugging: boolean = false

    /** @internal */
    static isEmpty(doc: Y.Doc): boolean {
        return doc.getMap("boxes").size === 0
    }

    static async populateRoom<T>(construct: Construct<T>): Promise<YSync<T>> {
        const {boxGraph, boxes} = construct
        console.debug("populate")
        assert(boxes.size === 0, "boxes must be empty")
        const sync = new YSync<T>(construct)
        try {
            const doc = asDefined(boxes.doc, "Y.Map is not connected to Y.Doc")
            const prepared = boxGraph.boxes().map(box =>
                [UUID.toString(box.address.uuid), YMapper.createBoxMap(box)] as const)
            doc.transact(() => prepared.forEach(([key, map]) => boxes.set(key, map)), "[openDAW] populate")
            return sync
        } catch (error) {
            sync.terminate()
            throw error
        }
    }

    static async joinRoom<T>(construct: Construct<T>): Promise<YSync<T>> {
        const {boxGraph, boxes} = construct
        console.debug("join")
        assert(boxGraph.boxes().length === 0, "BoxGraph must be empty")
        assert(!boxGraph.inTransaction(), "BoxGraph must not be in a transaction")
        const sync = new YSync<T>(construct)
        sync.#ignoreUpdates = true
        try {
            boxGraph.beginTransaction()
            boxes.forEach((value, key) => sync.#createBox(key))
            boxGraph.endTransaction()
            return sync
        } catch (error) {
            try {
                if (boxGraph.inTransaction()) {boxGraph.abortTransaction()}
            } finally {
                sync.terminate()
            }
            throw error
        } finally {
            sync.#ignoreUpdates = false
        }
    }

    static #computePathPrefix(boxes: Y.Map<unknown>): ReadonlyArray<string | number> {
        const prefix: Array<string | number> = []
        let item = (boxes as unknown as { _item: unknown })._item as
            { parentSub: string | number, parent: { _item: unknown } } | null
        while (item !== null) {
            prefix.unshift(item.parentSub)
            const parent = item.parent as unknown as { _item: unknown }
            item = parent._item as typeof item
        }
        return prefix
    }

    readonly #terminator = new Terminator()
    readonly #boxGraph: BoxGraph<T>
    readonly #conflict: Option<Provider<boolean>>
    readonly #boxes: Y.Map<unknown>
    readonly #updates: Array<Update>
    readonly #pathPrefix: ReadonlyArray<string | number>

    #ignoreUpdates: boolean = false

    constructor({boxGraph, boxes, conflict}: Construct<T>) {
        this.#boxGraph = boxGraph
        this.#conflict = Option.wrap(conflict)
        this.#boxes = boxes
        this.#updates = []
        this.#pathPrefix = YSync.#computePathPrefix(boxes)
        this.#terminator.ownAll(this.#setupYjs(), this.#setupOpenDAW())
    }

    terminate(): void {this.#terminator.terminate()}

    #setupYjs(): Subscription {
        // Capture only refused remote transactions. UndoManager preserves deleted
        // shared types, unlike reinserting a previously integrated Y.Map.
        let rejected: Y.Transaction | undefined
        const undo = new Y.UndoManager(this.#boxes, {
            captureTimeout: 0,
            trackedOrigins: new Set(),
            captureTransaction: transaction => transaction === rejected
        })
        const doc = this.#getDoc()
        const revert = (transaction: Y.Transaction) => {
            if (transaction !== rejected) {return}
            rejected = undefined
            undo.undo()
            undo.clear()
            undo.removeTrackedOrigin(transaction.origin)
        }
        doc.on("afterTransaction", revert)
        const eventHandler: EventHandler = (events, transaction) => {
            const {origin, local} = transaction
            const originLabel = typeof origin === "string" ? origin : "Unkown Origin"
            const isOwnOrigin = typeof origin === "string" && origin.startsWith("[openDAW]")
            const isHistoryReplay = typeof origin === "string" && origin.startsWith("[history]")
            console.debug(`got ${events.length} ${local ? "local" : "external"} updates from '${originLabel}', isHistoryReplay: ${isHistoryReplay}, isOwnOrigin: ${isOwnOrigin}`)
            if (origin === undo || isOwnOrigin || (local && !isHistoryReplay)) {return}
            const applied: Update[] = []
            const capture = this.#boxGraph.subscribeToAllUpdatesImmediate({onUpdate: update => applied.push(update)})
            this.#boxGraph.beginTransaction()
            const result = tryCatch(() => {
                for (const event of events) {
                    const path = this.#normalizePath(event.path)
                    const keys = event.changes.keys
                    for (const [key, change] of keys.entries()) {
                        if (YSync.debugging) {
                            console.debug(`${change.action} on ${path}:${key}`)
                        }
                        if (change.action === "add") {
                            assert(path.length === 0, "'Add' cannot have a path")
                            this.#createBox(key)
                        } else if (change.action === "update") {
                            if (path.length === 0) {this.#createBox(key); continue}
                            assert(path.length >= 2, "Invalid path: must have at least 2 elements (uuid, 'fields').")
                            this.#updateValue(path, key)
                        } else if (change.action === "delete") {
                            assert(path.length === 0, "'Delete' cannot have a path")
                            this.#deleteBox(key)
                        }
                    }
                }
                this.#ignoreUpdates = true
                this.#boxGraph.endTransaction()
                // Pointer hubs are finalized by endTransaction. Evaluate the
                // project policy on that complete state, then restore both models.
                const conflict = tryCatch(() => this.#conflict.mapOr(check => check(), false))
                if (conflict.status === "failure" || conflict.value) {
                    capture.terminate()
                    this.#boxGraph.beginTransaction()
                    applied.toReversed().forEach(update => update.inverse(this.#boxGraph))
                    this.#boxGraph.endTransaction()
                    rejected = transaction
                    undo.addTrackedOrigin(origin)
                }
                this.#ignoreUpdates = false
            })
            capture.terminate()
            if (result.status === "failure") {
                this.#ignoreUpdates = false
                if (this.#boxGraph.inTransaction()) {
                    this.#boxGraph.abortTransaction()
                }
                rejected = transaction
                undo.addTrackedOrigin(origin)
                console.warn("[YSync] Transaction rejected:", result.error)
                return
            }
        }
        this.#boxes.observeDeep(eventHandler)
        return {terminate: () => {
            this.#boxes.unobserveDeep(eventHandler)
            doc.off("afterTransaction", revert)
            undo.destroy()
        }}
    }

    #createBox(key: string): void {
        const map = asInstanceOf(this.#boxes.get(key), Y.Map)
        const name = map.get("name") as keyof T
        const fields = asInstanceOf(map.get("fields"), Y.Map)
        const uuid = UUID.parse(key)
        const optBox = this.#boxGraph.findBox(UUID.parse(key))
        if (optBox.isEmpty()) {
            this.#boxGraph.createBox(name, uuid, box => YMapper.applyFromBoxMap(box, fields))
        } else {
            assert(optBox.unwrap().name === name, "Incompatible box type replacement")
            console.debug(`Box '${key}' has already been created. Performing 'Upsert'.`)
            YMapper.applyFromBoxMap(optBox.unwrap(), fields)
        }
    }

    #normalizePath(path: ReadonlyArray<string | number>): ReadonlyArray<string | number> {
        const prefix = this.#pathPrefix
        if (prefix.length === 0 || path.length < prefix.length) {return path}
        for (let i = 0; i < prefix.length; i++) {
            if (path[i] !== prefix[i]) {return path}
        }
        return path.slice(prefix.length)
    }

    #updateValue(path: ReadonlyArray<string | number>, key: string): void {
        const address = YMapper.pathToAddress(path, key)
        const vertex = this.#boxGraph.findVertex(address)
            .unwrap(`Vertex at '${address.toString()}' does not exist.`)
        const [uuidAsString, fieldsKey, ...fieldKeys] = path
        const targetMap = YMapper.findMap((this.#boxes
            .get(String(uuidAsString)) as Y.Map<unknown>)
            .get(String(fieldsKey)) as Y.Map<unknown>, fieldKeys)
        assert(vertex.isField(), "Vertex must be either Primitive or Pointer")
        vertex.accept({
            visitField: (_: Field) => panic("Vertex must be either Primitive or Pointer"),
            visitArrayField: (_: ArrayField) => panic("Vertex must be either Primitive or Pointer"),
            visitObjectField: (_: ObjectField<import("@opendaw/lib-box").Fields>) => panic("Vertex must be either Primitive or Pointer"),
            visitPointerField: (field: PointerField) => field.fromJSON(targetMap.get(key) as JSONValue),
            visitPrimitiveField: (field: PrimitiveField) => field.fromJSON(targetMap.get(key) as JSONValue)
        })
    }

    #deleteBox(key: string): void {
        const box = this.#boxGraph.findBox(UUID.parse(key))
            .unwrap(`Box '${key}' does not exist.`)
        box.outgoingEdges().forEach(([pointer]) => pointer.defer())
        box.incomingEdges().forEach(pointer => pointer.defer())
        this.#boxGraph.unstageBox(box)
    }

    #setupOpenDAW(): Terminable {
        return Terminable.many(
            this.#boxGraph.subscribeTransaction({
                onBeginTransaction: EmptyExec,
                onEndTransaction: (rolledBack) => {
                    const pending = this.#updates.splice(0)
                    if (this.#ignoreUpdates || rolledBack) {return}
                    const optimized = optimizeUpdates(pending)
                    if (optimized.length === 0) {return}
                    const result = tryCatch(() => this.#getDoc()
                        .transact(() => optimized.forEach(update => this.#applyUpdate(update)),
                            "[openDAW] updates"))
                    if (result.status === "failure") {
                        console.error("[YSync] flush failed, dropping updates", {
                            count: optimized.length,
                            error: result.error
                        })
                        throw result.error
                    }
                }
            }),
            this.#boxGraph.subscribeToAllUpdatesImmediate({
                onUpdate: (update: Update): unknown => this.#updates.push(update)
            })
        )
    }

    /**
     * TRANSFER ONE CHANGE FROM OPENDAW TO YJS
     */
    #applyUpdate(update: Update): void {
        if (update.type === "new") {
            const uuid = update.uuid
            const key = UUID.toString(uuid)
            const optBox = this.#boxGraph.findBox(uuid)
            if (optBox.isEmpty()) {
                // Phantom box: created and removed in same transaction.
                // optimizeUpdates should have filtered this, but guard in case.
                return
            }
            this.#boxes.set(key, YMapper.createBoxMap(optBox.unwrap()))
        } else if (update.type === "primitive") {
            const key = UUID.toString(update.address.uuid)
            const boxObject = this.#boxes.get(key)
            if (!isInstanceOf(boxObject, Y.Map)) {
                console.warn(`[YSync] primitive update skipped: box '${key}' missing`)
                return
            }
            const field = this.#resolveFieldMap(boxObject, key, update.address.fieldKeys)
            if (field === undefined) {return}
            field.set(String(update.address.fieldKeys[update.address.fieldKeys.length - 1]),
                update.newValue)
        } else if (update.type === "pointer") {
            const key = UUID.toString(update.address.uuid)
            const boxObject = this.#boxes.get(key)
            if (!isInstanceOf(boxObject, Y.Map)) {
                console.warn(`[YSync] pointer update skipped: box '${key}' missing`)
                return
            }
            const field = this.#resolveFieldMap(boxObject, key, update.address.fieldKeys)
            if (field === undefined) {return}
            field.set(String(update.address.fieldKeys[update.address.fieldKeys.length - 1]),
                update.newAddress.mapOr(address => address.toString(), null))
        } else if (update.type === "delete") {
            this.#boxes.delete(UUID.toString(update.uuid))
        }
    }

    /**
     * Walks from the box map down to the Y.Map that owns `fieldKeys[last]`.
     * Returns `undefined` (with a warning) instead of throwing if the path
     * cannot be resolved — protects the yjs transaction from partial writes.
     */
    #resolveFieldMap(boxObject: Y.Map<unknown>,
                     key: string,
                     fieldKeys: ArrayLike<number>): Y.Map<unknown> | undefined {
        const fieldsValue = boxObject.get("fields")
        if (!isInstanceOf(fieldsValue, Y.Map)) {
            console.warn(`[YSync] box '${key}' missing 'fields' Y.Map; skipping update`)
            return undefined
        }
        let field = fieldsValue as Y.Map<unknown>
        for (let i = 0; i < fieldKeys.length - 1; i++) {
            const next = field.get(String(fieldKeys[i]))
            if (!isInstanceOf(next, Y.Map)) {
                console.warn(`[YSync] box '${key}' field path broken at '${fieldKeys[i]}'; skipping update`)
                return undefined
            }
            field = next as Y.Map<unknown>
        }
        return field
    }

    #getDoc(): Y.Doc {
        return asDefined(this.#boxes.doc, "Y.Map is not connect to Y.Doc")
    }
}