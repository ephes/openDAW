import {
    clamp,
    Editing,
    int,
    Notifier,
    Observer,
    Option,
    Selection,
    Terminable,
    unitValue,
    ValueAxis
} from "@opendaw/lib-std"
import {Line, NoteModifyStrategy} from "../NoteModifyStrategies.ts"
import {NoteEventBoxAdapter, NoteEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {EventCollection, NoteEvent, ppqn} from "@opendaw/lib-dsp"
import {NoteModifier} from "@/ui/timeline/editors/notes/NoteModifier.ts"
import {
    NotePropertyCent,
    NotePropertyChance,
    NotePropertyVelocity,
    PropertyAccessor
} from "@/ui/timeline/editors/notes/property/PropertyAccessor.ts"

import {NoteEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader.ts"
import {UINoteEvent} from "@/ui/timeline/editors/notes/UINoteEvent.ts"
import {Dragging} from "@opendaw/lib-dom"

class SelectedModifyStrategy implements NoteModifyStrategy {
    readonly #tool: PropertyNodeModifier

    constructor(tool: PropertyNodeModifier) {this.#tool = tool}

    readPosition(adapter: NoteEventBoxAdapter): ppqn {return adapter.position}
    readComplete(adapter: NoteEventBoxAdapter): ppqn {return adapter.complete}
    readPitch(adapter: NoteEventBoxAdapter): number {return adapter.pitch}
    readVelocity(adapter: NoteEventBoxAdapter): unitValue {return this.modifyProperty(NotePropertyVelocity, adapter)}
    readCent(adapter: NoteEventBoxAdapter): number {return this.modifyProperty(NotePropertyCent, adapter)}
    readChance(adapter: NoteEventBoxAdapter): number {return this.modifyProperty(NotePropertyChance, adapter)}
    iterateRange<R extends NoteEvent>(regions: EventCollection<R>, from: ppqn, to: ppqn): Iterable<R> {
        return regions.iterateRange(from, to)
    }

    modifyProperty(propertyAccessor: PropertyAccessor, event: UINoteEvent): number {
        const toolProperty = this.#tool.property
        const rawValue = this.#tool.readBaseValue(propertyAccessor, event)
        if (propertyAccessor === toolProperty && this.#tool.isSelected(event)) {
            const {valueMapping} = toolProperty
            return valueMapping.y(clamp(valueMapping.x(rawValue) + this.#tool.deltaProperty, 0.0, 1.0))
        } else {
            return rawValue
        }
    }
}

type Construct = Readonly<{
    editing: Editing
    element: Element
    selection: Selection<NoteEventBoxAdapter>
    property: PropertyAccessor
    valueAxis: ValueAxis
    pointerValue: number
}>

export class PropertyNodeModifier implements NoteModifier {
    static create(construct: Construct): PropertyNodeModifier {
        return new PropertyNodeModifier(construct)
    }

    readonly #editing: Editing
    readonly #element: Element
    readonly #notes: ReadonlyMap<NoteEventBoxAdapter, {owner: NoteEventCollectionBoxAdapter, value: number}>
    readonly #property: PropertyAccessor
    readonly #valueAxis: ValueAxis
    readonly #pointerValue: number

    readonly #notifier: Notifier<void>
    readonly #selectedModifyStrategy: SelectedModifyStrategy

    #deltaProperty: number

    private constructor({editing, element, selection, property, valueAxis, pointerValue}: Construct) {
        this.#editing = editing
        this.#element = element
        this.#notes = new Map(selection.selected()
            .filter(note => note.box.isAttached() && note.collection.nonEmpty())
            .map(note => [note, {owner: note.collection.unwrap(), value: property.readRawValue(note)}]))
        this.#property = property
        this.#valueAxis = valueAxis
        this.#pointerValue = pointerValue

        this.#notifier = new Notifier<void>()
        this.#selectedModifyStrategy = new SelectedModifyStrategy(this)

        this.#deltaProperty = 0.0
    }

    subscribeUpdate(observer: Observer<void>): Terminable {return this.#notifier.subscribe(observer)}

    get property(): PropertyAccessor {return this.#property}
    get deltaProperty(): ppqn {return this.#deltaProperty}

    isSelected(note: UINoteEvent): boolean {return this.owns(note as NoteEventBoxAdapter)}

    owns(note: NoteEventBoxAdapter): boolean {
        const base = this.#notes.get(note)
        return base !== undefined && note.box.isAttached() && base.owner.box.isAttached()
            && note.collection.contains(base.owner) && this.#property.readRawValue(note) === base.value
    }

    readBaseValue(property: PropertyAccessor, note: UINoteEvent): number {
        return property === this.#property && this.isSelected(note)
            ? this.#notes.get(note as NoteEventBoxAdapter)!.value : property.readRawValue(note)
    }

    showOrigin(): boolean {return false}
    showCreation(): Option<UINoteEvent> {return Option.None}
    showPropertyLine(): Option<Line> {return Option.None}
    readContentDuration(region: NoteEventOwnerReader): number {return region.contentDuration}
    selectedModifyStrategy(): NoteModifyStrategy {return this.#selectedModifyStrategy}
    unselectedModifyStrategy(): NoteModifyStrategy {return NoteModifyStrategy.Identity}

    update({clientY}: Dragging.Event): void {
        const clientRect = this.#element.getBoundingClientRect()
        const deltaProperty: int = this.#valueAxis.axisToValue(clientY - clientRect.top) - this.#pointerValue
        if (this.#deltaProperty !== deltaProperty) {
            this.#deltaProperty = deltaProperty
            this.#dispatchChange()
        }
    }

    approve(): void {
        if (this.#deltaProperty === 0.0) {return}
        const result: ReadonlyArray<{ adapter: NoteEventBoxAdapter, value: number }> = Array.from(this.#notes.keys()).filter(note => this.owns(note))
            .map(adapter => ({adapter, value: this.#selectedModifyStrategy.modifyProperty(this.#property, adapter)}))
        if (result.length === 0) {return}
        this.#editing.modify(() => result.forEach(({adapter: {box}, value}) =>
            this.#property.writeValue(box, value)))
    }

    cancel(): void {
        this.#deltaProperty = 0.0
        this.#dispatchChange()
    }

    #dispatchChange(): void {this.#notifier.notify()}
}