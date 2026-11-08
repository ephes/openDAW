import {assert, clamp, identity, int, Objects, Option, Terminable, UUID} from "@opendaw/lib-std"
import {Event, Groove, ppqn} from "@opendaw/lib-dsp"
import {AutomatableParameter} from "../../AutomatableParameter"
import {ActiveNoteEvent, NoteEventSource, NoteLifecycleEvent} from "../../NoteEventSource"
import {GrooveAdapter, NoteBroadcaster, ZeitgeistDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EventProcessor} from "../../EventProcessor"
import {Block} from "../../processing"
import {EngineContext} from "../../EngineContext"
import {MidiEffectProcessor} from "../../MidiEffectProcessor"

export class ZeitgeistDeviceProcessor extends EventProcessor implements MidiEffectProcessor {
    readonly #adapter: ZeitgeistDeviceBoxAdapter

    readonly #noteBroadcaster: NoteBroadcaster

    #groove: Option<GrooveAdapter> = Option.None
    #source: Option<NoteEventSource> = Option.None

    constructor(context: EngineContext, adapter: ZeitgeistDeviceBoxAdapter) {
        super(context)

        this.#adapter = adapter

        this.#noteBroadcaster = this.own(new NoteBroadcaster(context.broadcaster, adapter.address))

        this.ownAll(
            // The registry owns groove adapters; this processor only owns the pointer subscription.
            adapter.box.groove.catchupAndSubscribe(pointer => {
                this.#groove = Option.wrap(pointer.targetVertex.isEmpty()
                    ? null
                    : context.boxAdapters.adapterFor(pointer.targetVertex.unwrap().box, GrooveAdapter.checkType))
            }),
            Terminable.create(() => {
                this.#groove = Option.None
            }),
            context.registerProcessor(this)
        )
    }

    get uuid(): UUID.Bytes {return this.#adapter.uuid}

    index(): int {return this.#adapter.indexField.getValue()}
    adapter(): ZeitgeistDeviceBoxAdapter {return this.#adapter}

    setNoteEventSource(source: NoteEventSource): Terminable {
        assert(this.#source.isEmpty(), "NoteEventSource already set")
        this.#source = Option.wrap(source)
        return Terminable.create(() => this.#source = Option.None)
    }

    * processNotes(from: ppqn, to: ppqn, flags: int): IterableIterator<NoteLifecycleEvent> {
        if (this.#source.isEmpty()) {return}
        const source = this.#source.unwrap()
        const groove: Groove = this.#groove.mapOr(identity, Groove.Identity)
        for (const event of source.processNotes(groove.unwarp(from), groove.unwarp(to), flags)) {
            if (NoteLifecycleEvent.isStart(event)) {
                this.#noteBroadcaster.noteOn(event.pitch)
            } else {
                this.#noteBroadcaster.noteOff(event.pitch)
            }
            yield Objects.overwrite(event, {position: clamp(groove.warp(event.position), from, to)})
        }
    }

    * iterateActiveNotesAt(position: ppqn, onlyExternal: boolean): IterableIterator<ActiveNoteEvent> {
        if (this.#source.isEmpty()) {return}
        const source = this.#source.unwrap()
        const groove: Groove = this.#groove.mapOr(identity, Groove.Identity)
        for (const event of source.iterateActiveNotesAt(groove.unwarp(position), onlyExternal)) {
            const start = groove.warp(event.position)
            const end = event.position + event.duration
            yield Objects.overwrite(event, {position: start,
                duration: Number.isFinite(end) ? groove.warp(end) - start : event.duration})
        }
    }

    reset(): void {this.eventInput.clear()}

    parameterChanged(_parameter: AutomatableParameter): void {}

    handleEvent(_block: Readonly<Block>, _event: Event): void {}
    processEvents(_block: Readonly<Block>, _from: number, _to: number): void {}
}
