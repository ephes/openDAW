import {
    asInstanceOf,
    assert,
    Bijective,
    Editing,
    Exec,
    int,
    Listeners,
    Option,
    Predicate,
    Selection,
    SelectionListener,
    SortedSet,
    Subscription,
    Terminator,
    tryCatch,
    UUID
} from "@opendaw/lib-std"
import {Address, Addressable, BoxGraph, Field, PointerField, PointerListener} from "@opendaw/lib-box"
import {Pointers} from "@opendaw/studio-enums"
import {SelectionBox} from "@opendaw/studio-boxes"
import {SelectableVertex} from "./SelectableVertex"
import {SelectionEntry} from "./SelectionEntry"
import {FilteredSelection} from "./FilteredSelection"
import {catchupSelection} from "./catchupSelection"

export type SelectionIndex = {added(selectable: SelectableVertex): void, removed(selectable: SelectableVertex): void}

/**
 * Represents the main selection management within a document.
 * This class maintains selections for different users, with each user having their own unique selection.
 */
export class VertexSelection implements Selection<SelectableVertex> {
    readonly #lifeTime: Terminator
    readonly #entityMap: SortedSet<UUID.Bytes, SelectionEntry> // sorted on entity
    readonly #selectableMap: SortedSet<Address, SelectionEntry> // sorted on selectable
    readonly #listeners: Listeners<SelectionListener<SelectableVertex>>

    #target: Option<Field> = Option.None
    #generation: number = 0
    #modifying: number = 0
    // Listeners are told about changes after the pointer transaction; the indexes below
    // (and every FilteredSelection index) change synchronously. `#delivered` holds what
    // listeners were last told is selected, so deferred delivery stays balanced.
    #pending: Array<SelectableVertex> = []
    #flushScheduled: boolean = false
    readonly #delivered: SortedSet<Address, SelectableVertex> = Address.newSet(selectable => selectable.address)
    readonly #indexes: Set<SelectionIndex> = new Set()

    constructor(readonly editing: Editing, readonly boxGraph: BoxGraph) {
        this.#lifeTime = new Terminator()
        this.#entityMap = UUID.newSet(entry => entry.box.address.uuid)
        this.#selectableMap = Address.newSet(entry => entry.selectable.address)
        this.#listeners = new Listeners<SelectionListener<SelectableVertex>>()
    }

    switch(target: Field<Pointers.Selection>): this {
        const generation = this.#generation + 1
        this.release()
        if (generation !== this.#generation) {return this}
        console.debug(`VertexSelection.switch(${target.address.toString()})`)
        this.#target = Option.wrap(target)
        this.#watch(target)
        return this
    }

    release(): void {
        this.#generation++
        if (this.#target.isEmpty()) {return}
        this.#target = Option.None
        const previous = this.selected()
        this.#selectableMap.clear()
        this.#entityMap.clear()
        this.#lifeTime.terminate()
        previous.forEach(selectable => this.#indexes.forEach(index => index.removed(selectable)))
        this.#delivered.values().slice().forEach(selectable => this.#reconcile(selectable))
    }

    /** Synchronous index hook for derived selections; it must not call back into the selection. */
    subscribeIndex(index: SelectionIndex): Subscription {
        this.#indexes.add(index)
        return {terminate: () => {this.#indexes.delete(index)}}
    }

    createFilteredSelection<T extends Addressable>(affiliate: Predicate<SelectableVertex>,
                                                   map: Bijective<T, SelectableVertex>): FilteredSelection<T> {
        return new FilteredSelection<T>(this, affiliate, map)
    }

    select(...selectables: ReadonlyArray<SelectableVertex>): void {
        if (this.#target.isEmpty()) {
            console.debug(`Cannot select without a user`)
            return
        }
        if (selectables.length === 0) {return}
        const generation = this.#generation
        this.#modify(() => {
            const selection = this.#target.unwrap()
            for (const selectable of selectables) {
                if (generation !== this.#generation) {break}
                if (!selectable.isAttached()) {continue}
                if (!this.#selectableMap.hasKey(selectable.address)) {
                    SelectionBox.create(this.boxGraph, UUID.generate(), box => {
                        box.selectable.refer(selectable)
                        box.selection.refer(selection)
                    })
                }
            }
        })
    }

    deselect(...selectables: ReadonlyArray<SelectableVertex>): void {
        if (this.#target.isEmpty()) {
            console.debug(`Cannot deselect without a user`)
            return
        }
        if (selectables.length === 0) {return}
        this.#modify(() => selectables
            .forEach(selectable => this.#selectableMap.opt(selectable.address)
                .ifSome(entry => entry.box.delete())))
    }

    deselectAll(): void {
        this.deselect(...this.#selectableMap.values().map(entry => entry.selectable))
    }

    distance(inventory: Iterable<SelectableVertex>): ReadonlyArray<SelectableVertex> {
        const excludes: Array<SelectableVertex> = []
        for (const selectable of inventory) {
            if (!this.#selectableMap.hasKey(selectable.address)) {excludes.push(selectable)}
        }
        return excludes
    }

    isEmpty(): boolean {return this.#selectableMap.size() === 0}
    nonEmpty(): boolean {return this.#selectableMap.size() > 0}

    count(): int {return this.#selectableMap.size()}

    isSelected(selectable: SelectableVertex): boolean {return this.#selectableMap.hasKey(selectable.address)}

    selected(): ReadonlyArray<SelectableVertex> {return this.#selectableMap.values().map(entry => entry.selectable)}

    subscribe(listener: SelectionListener<SelectableVertex>): Subscription {return this.#listeners.subscribe(listener)}

    catchupAndSubscribe(listener: SelectionListener<SelectableVertex>): Subscription {
        return catchupSelection({
            delivered: () => this.#delivered.values(),
            isDelivered: selectable => this.#delivered.hasKey(selectable.address),
            subscribe: listener => this.#listeners.subscribe(listener)
        }, listener)
    }

    #watch(target: Field): void {
        const generation = this.#generation
        const observer: PointerListener = {
            onAdded: (pointer: PointerField) => {
                if (generation !== this.#generation || !target.pointerHub.contains(pointer)
                    || this.#entityMap.hasKey(pointer.box.address.uuid)) {return}
                this.#added(asInstanceOf(pointer.box, SelectionBox))
            },
            onRemoved: (pointer: PointerField) => {
                if (generation !== this.#generation) {return}
                this.#removed(asInstanceOf(pointer.box, SelectionBox))
            }
        }
        this.#lifeTime.own(target.pointerHub.subscribe(observer, Pointers.Selection))
        target.pointerHub.filter(Pointers.Selection).forEach(pointer => observer.onAdded(pointer))
    }

    #added(box: SelectionBox): void {
        if (this.#entityMap.hasKey(box.address.uuid)) {return}
        assert(box.isAttached(), "SelectionBox is not attached")
        const selectable = box.selectable.targetVertex.unwrap("SelectionBox has no target") as SelectableVertex
        const entry: SelectionEntry = {box, selectable}
        assert(this.#entityMap.add(entry), "Could not add to entityMap")
        assert(this.#selectableMap.add(entry), "Could not add to selectableMap")
        this.#indexes.forEach(index => index.added(selectable))
        this.#notify(selectable)
    }

    #removed(box: SelectionBox): void {
        if (!this.#entityMap.hasKey(box.address.uuid)) {return}
        const entry = this.#entityMap.removeByKey(box.address.uuid)
        assert(entry.box === box, "Broken selection")
        this.#selectableMap.removeByKey(entry.selectable.address)
        this.#indexes.forEach(index => index.removed(entry.selectable))
        this.#notify(entry.selectable)
    }

    #modify(modifier: Exec): void {
        this.#modifying++
        const result = tryCatch(() => this.editing.modify(modifier, false))
        this.#modifying--
        if (this.#modifying === 0 && !this.boxGraph.inTransaction()) {this.#flush()}
        if (result.status === "failure") {throw result.error}
    }

    #notify(selectable: SelectableVertex): void {
        this.#pending.push(selectable)
        if (this.#modifying > 0) {return}
        // External graph edits (including undo/redo) notify from inside pointer finalization,
        // where listeners must not start a new modification yet.
        if (this.boxGraph.inTransaction()) {
            if (!this.#flushScheduled) {
                this.#flushScheduled = true
                queueMicrotask(() => {
                    this.#flushScheduled = false
                    this.#flush()
                })
            }
        } else {this.#flush()}
    }

    #flush(): void {
        // Reentrant listener changes append to the queue and drain in this same loop.
        while (this.#pending.length > 0) {this.#reconcile(this.#pending.shift()!)}
    }

    // Deliver only the transition from what listeners were last told to the current state,
    // so superseded or reverted changes never produce an unmatched select or deselect.
    #reconcile(selectable: SelectableVertex): void {
        const selected = this.isSelected(selectable)
        if (selected === this.#delivered.hasKey(selectable.address)) {return}
        if (selected) {
            this.#delivered.add(selectable)
            this.#listeners.proxy.onSelected(selectable)
        } else {
            this.#listeners.proxy.onDeselected(this.#delivered.removeByKey(selectable.address))
        }
    }
}
