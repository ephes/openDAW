import {
    clampUnit,
    Curve,
    Editing,
    Iterables,
    Notifier,
    Observer,
    Option,
    panic,
    Terminable,
    Terminator,
    unitValue,
    ValueAxis
} from "@opendaw/lib-std"
import {Propagation} from "@opendaw/lib-box"
import {ValueEventBoxAdapter, ValueEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {Interpolation, ppqn, ValueEvent} from "@opendaw/lib-dsp"
import {ValueModifier} from "./ValueModifier"
import {ValueEventDraft} from "@/ui/timeline/editors/value/ValueEventDraft.ts"
import {ValueEventOwnerReader} from "../EventOwnerReader"
import {Dragging} from "@opendaw/lib-dom"

type Construct = Readonly<{
    editing: Editing
    element: Element
    valueAxis: ValueAxis
    reference: ValueEventBoxAdapter
    collection: ValueEventCollectionBoxAdapter
    pointerY: number
}>

export class ValueSlopeModifier implements ValueModifier {
    static create(construct: Construct): ValueSlopeModifier {return new ValueSlopeModifier(construct)}

    readonly #editing: Editing
    readonly #element: Element
    readonly #reference: ValueEventBoxAdapter
    readonly #successor: ValueEventBoxAdapter
    readonly #collection: ValueEventCollectionBoxAdapter

    readonly #notifier: Notifier<void>

    readonly #y0: number
    readonly #y1: number
    readonly #initialMidY: number
    readonly #initialInterpolation: Interpolation

    #slope: unitValue
    readonly #segmentLife = new Terminator()
    #valid = true
    #lastLocalY: number
    #accumulatedDeltaY: number = 0

    private constructor({editing, element, valueAxis, reference, collection, pointerY}: Construct) {
        this.#editing = editing
        this.#element = element
        this.#reference = reference
        this.#successor = ValueEvent.nextEvent<ValueEventBoxAdapter>(collection.events, reference)
            ?? panic("No successor event")
        this.#collection = collection
        this.#lastLocalY = pointerY - element.getBoundingClientRect().top

        this.#notifier = new Notifier<void>()

        const interpolation = reference.interpolation
        this.#initialInterpolation = interpolation
        this.#slope = interpolation.type === "curve" ? interpolation.slope : 0.5
        this.#y0 = valueAxis.valueToAxis(reference.value)
        this.#y1 = valueAxis.valueToAxis(this.#successor.value)
        this.#initialMidY = Curve.normalizedAt(0.5, this.#slope) * (this.#y1 - this.#y0) + this.#y0
        const retire = () => {
            this.#valid = false
            this.#segmentLife.terminate()
            this.#dispatchChange()
        }
        this.#segmentLife.ownAll(
            reference.box.subscribe(Propagation.Children, retire),
            this.#successor.box.subscribe(Propagation.Children, retire),
            collection.subscribeChange(() => {
                if (!this.#isCurrent()) {this.#dispatchChange()}
            }))
    }

    subscribeUpdate(observer: Observer<void>): Terminable {return this.#notifier.subscribe(observer)}

    showOrigin(): boolean {return false}
    snapValue(): Option<unitValue> {return Option.None}
    translateSearch(value: ppqn): ppqn {return value}
    isVisible(_event: ValueEvent): boolean {return true}
    readPosition(event: ValueEvent): ppqn {return event.position}
    readValue(event: ValueEvent): unitValue {return event.value}
    readInterpolation(event: ValueEventBoxAdapter): Interpolation {
        if (event !== this.#reference || !this.#isCurrent()) {return event.interpolation}
        return this.#slope === 0.5 ? Interpolation.Linear : Interpolation.Curve(this.#slope)
    }
    readContentDuration(owner: ValueEventOwnerReader): number {return owner.contentDuration}
    iterator(searchMin: ppqn, searchMax: ppqn): IterableIterator<ValueEventDraft> {
        return Iterables.map(ValueEvent.iterateWindow(this.#collection.events, searchMin, searchMax), event => ({
            type: "value-event",
            position: event.position,
            value: event.value,
            interpolation: this.readInterpolation(event),
            index: event.index,
            isSelected: event.isSelected,
            direction: 0
        }))
    }

    update({clientY, altKey}: Dragging.Event): void {
        if (!this.#isCurrent()) {this.cancel(); return}
        const clientRect = this.#element.getBoundingClientRect()
        const localY = clientY - clientRect.top
        const incrementalDelta = localY - this.#lastLocalY
        this.#accumulatedDeltaY += incrementalDelta * (altKey ? 0.1 : 1.0)
        this.#lastLocalY = localY
        const targetY = this.#initialMidY + this.#accumulatedDeltaY
        let slope = clampUnit(Curve.slopeByHalf(this.#y0, targetY, this.#y1))
        if (!altKey && Math.abs(slope - 0.5) < 0.02) {slope = 0.5}
        if (this.#slope !== slope) {
            this.#slope = slope
            this.#dispatchChange()
        }
    }

    approve(): void {
        if (!this.#isCurrent()) {this.cancel(); return}
        this.#valid = false
        this.#segmentLife.terminate()
        const interpolation = this.#slope === 0.5 ? Interpolation.Linear : Interpolation.Curve(this.#slope)
        this.#editing.modify(() => this.#reference.interpolation = interpolation)
    }

    cancel(): void {
        this.#valid = false
        this.#segmentLife.terminate()
        const interpolation = this.#reference.interpolation
        this.#slope = interpolation.type === "curve" ? interpolation.slope : 0.5
        this.#accumulatedDeltaY = 0
        this.#dispatchChange()
    }

    #isCurrent(): boolean {
        if (!this.#valid) {return false}
        const events = this.#collection.events
        if (this.#collection.box.isAttached() && this.#reference.box.isAttached()
            && this.#successor.box.isAttached() && this.#reference.interpolation === this.#initialInterpolation
            && events.contains(this.#reference)
            && events.contains(this.#successor) && this.#reference.collection.contains(this.#collection)
            && this.#successor.collection.contains(this.#collection)
            && ValueEvent.nextEvent(events, this.#reference) === this.#successor) {return true}
        this.#valid = false
        this.#segmentLife.terminate()
        return false
    }

    #dispatchChange(): void {this.#notifier.notify()}
}