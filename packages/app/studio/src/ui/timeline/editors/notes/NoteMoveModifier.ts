import {
    byte,
    clamp,
    Editing,
    int,
    Notifier,
    Observer,
    Option,
    Selection,
    Subscription,
    Terminable,
    unitValue
} from "@opendaw/lib-std"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {Line, NoteModifyStrategy} from "./NoteModifyStrategies"
import {NoteEventBoxAdapter, NoteEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {EventCollection, NoteEvent, ppqn} from "@opendaw/lib-dsp"
import {NoteModifier} from "@/ui/timeline/editors/notes/NoteModifier.ts"
import {PitchPositioner} from "@/ui/timeline/editors/notes/pitch/PitchPositioner.ts"

import {NoteEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader.ts"
import {UINoteEvent} from "@/ui/timeline/editors/notes/UINoteEvent.ts"
import {Dragging} from "@opendaw/lib-dom"

class SelectedModifyStrategy implements NoteModifyStrategy {
    readonly #tool: NoteMoveModifier

    constructor(tool: NoteMoveModifier) {this.#tool = tool}

    readPosition(adapter: NoteEventBoxAdapter): ppqn {return adapter.position + (this.#tool.owns(adapter) ? this.#tool.deltaPosition : 0)}
    readComplete(adapter: NoteEventBoxAdapter): ppqn {return adapter.complete + (this.#tool.owns(adapter) ? this.#tool.deltaPosition : 0)}
    readPitch(adapter: NoteEventBoxAdapter): number {return this.#tool.owns(adapter) ? clamp(adapter.pitch + this.#tool.deltaPitch, 0, 127) : adapter.pitch}
    readVelocity(adapter: NoteEventBoxAdapter): unitValue {return adapter.velocity}
    readCent(adapter: NoteEventBoxAdapter): number {return adapter.cent}
    readChance(adapter: NoteEventBoxAdapter): number {return adapter.chance}
    iterateRange<R extends NoteEvent>(regions: EventCollection<R>, from: ppqn, to: ppqn): Iterable<R> {
        return regions.iterateRange(Math.min(from, from - this.#tool.deltaPosition),
            Math.max(to, to - this.#tool.deltaPosition))
    }
}

type Construct = Readonly<{
    editing: Editing
    element: Element
    selection: Selection<NoteEventBoxAdapter>
    positioner: PitchPositioner
    snapping: Snapping
    pointerPulse: ppqn
    pointerPitch: int
    reference: NoteEventBoxAdapter
}>

export class NoteMoveModifier implements NoteModifier {
    static create(construct: Construct): NoteMoveModifier {return new NoteMoveModifier(construct)}

    readonly #editing: Editing
    readonly #element: Element
    readonly #selection: Selection<NoteEventBoxAdapter>
    readonly #positioner: PitchPositioner
    readonly #snapping: Snapping
    readonly #pointerPulse: ppqn
    readonly #pointerPitch: int
    readonly #reference: NoteEventBoxAdapter
    readonly #notes: ReadonlyMap<NoteEventBoxAdapter, NoteEventCollectionBoxAdapter>
    readonly #destination: Option<NoteEventCollectionBoxAdapter>

    readonly #notifier: Notifier<void>
    readonly #pitchChanged: Notifier<byte>
    readonly #selectedModifyStrategy: NoteModifyStrategy

    #copy: boolean
    #repeat: boolean
    #deltaPitch: int
    #deltaPosition: ppqn

    private constructor({
                            editing,
                            element,
                            selection,
                            positioner,
                            snapping,
                            pointerPulse,
                            pointerPitch,
                            reference
                        }: Construct) {
        this.#editing = editing
        this.#element = element
        this.#selection = selection
        this.#positioner = positioner
        this.#snapping = snapping
        this.#pointerPulse = pointerPulse
        this.#pointerPitch = pointerPitch
        this.#reference = reference
        this.#destination = reference.collection
        this.#notes = new Map(selection.selected()
            .filter(note => note.box.isAttached() && note.collection.nonEmpty())
            .map(note => [note, note.collection.unwrap()]))

        this.#notifier = new Notifier<void>()
        this.#pitchChanged = new Notifier<byte>()
        this.#selectedModifyStrategy = new SelectedModifyStrategy(this)

        this.#copy = false
        this.#repeat = false
        this.#deltaPitch = 0
        this.#deltaPosition = 0
    }

    subscribePitchChanged(observer: Observer<byte>): Subscription {return this.#pitchChanged.subscribe(observer)}
    subscribeUpdate(observer: Observer<void>): Terminable {return this.#notifier.subscribe(observer)}

    get copy(): boolean {return this.#copy}
    get deltaPitch(): int {return this.#deltaPitch}
    get deltaPosition(): ppqn {return this.#deltaPosition}

    showOrigin(): boolean {return this.#copy}
    showCreation(): Option<UINoteEvent> {return Option.None}
    showPropertyLine(): Option<Line> {return Option.None}
    readContentDuration(region: NoteEventOwnerReader): number {return region.contentDuration}
    selectedModifyStrategy(): NoteModifyStrategy {return this.#selectedModifyStrategy}
    unselectedModifyStrategy(): NoteModifyStrategy {return this.#selectedModifyStrategy}

    owns(note: NoteEventBoxAdapter): boolean {
        const owner = this.#notes.get(note)
        return owner !== undefined && note.box.isAttached() && owner.box.isAttached()
            && note.collection.contains(owner)
    }

    update({clientX, clientY, ctrlKey, shiftKey}: Dragging.Event): void {
        const clientRect = this.#element.getBoundingClientRect()
        const notes = Array.from(this.#notes.keys()).filter(note => this.owns(note))
        const minPitch = notes.reduce((min, note) => Math.min(min, note.pitch), 127)
        const maxPitch = notes.reduce((max, note) => Math.max(max, note.pitch), 0)
        const deltaPitch: int = notes.length === 0 ? 0 : clamp(this.#positioner
            .yToPitch(clientY - clientRect.top) - this.#pointerPitch, -minPitch, 127 - maxPitch)
        const deltaPosition: int = this.#snapping
            .computeDelta(this.#pointerPulse, clientX - clientRect.left, this.#reference.position)
        let change = false
        if (this.#deltaPosition !== deltaPosition) {
            this.#deltaPosition = deltaPosition
            change = true
        }
        if (this.#deltaPitch !== deltaPitch) {
            this.#deltaPitch = deltaPitch
            if (this.owns(this.#reference)) {
                this.#pitchChanged.notify(this.#selectedModifyStrategy.readPitch(this.#reference))
            }
            change = true
        }
        if (this.#copy !== ctrlKey) {
            this.#copy = ctrlKey
            change = true
        }
        if (change) {this.#dispatchChange()}
        this.#repeat = shiftKey
    }

    approve(): void {
        if (this.#deltaPitch === 0 && this.#deltaPosition === 0) {
            if (this.#copy) {this.#dispatchChange()} // reset visuals
            this.#pitchChanged.terminate()
            return
        }
        const result = Array.from(this.#notes.keys()).filter(note => this.owns(note))
            .map<{ adapter: NoteEventBoxAdapter, pitch: int, position: ppqn }>(adapter => ({
                adapter,
                pitch: this.#selectedModifyStrategy.readPitch(adapter),
                position: this.#selectedModifyStrategy.readPosition(adapter)
            }))
        if (result.length === 0 || (this.#copy && !this.#destination
            .mapOr(collection => collection.box.isAttached(), false))) {
            this.#pitchChanged.terminate()
            return
        }
        this.#editing.modify(() => {
            if (this.#copy) {
                this.#selection.deselectAll()
                const events = this.#destination.unwrap().box.events
                if (this.#repeat && this.#deltaPosition !== 0) {
                    const numberOfCopies = 1 // TODO Open a dialog and ask for number of copies
                    for (let i = 0; i < numberOfCopies; i++) {
                        result.map(({adapter, position}) => adapter.copyTo({
                            position: position + this.#deltaPosition * i,
                            pitch: this.#selectedModifyStrategy.readPitch(adapter),
                            events
                        }))
                    }
                } else {
                    this.#selection.select(...(result
                        .map(({adapter, position, pitch}) => adapter.copyTo({position, pitch, events}))))
                }
            } else {
                result.forEach(({adapter: {box}, position, pitch}) => {
                    box.pitch.setValue(pitch)
                    box.position.setValue(position)
                })
            }
        })
        this.#pitchChanged.terminate()
    }

    cancel(): void {
        this.#deltaPitch = 0
        this.#deltaPosition = 0
        this.#dispatchChange()
        this.#pitchChanged.terminate()
    }

    #dispatchChange(): void {this.#notifier.notify()}
}