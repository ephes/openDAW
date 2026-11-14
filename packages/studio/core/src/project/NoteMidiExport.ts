import {ArrayMultimap, int} from "@opendaw/lib-std"
import {EventCollection, EventSpan, NoteEvent, PPQN, ppqn} from "@opendaw/lib-dsp"
import {Channel, ControlEvent, ControlType, MidiFile, MidiTrack} from "@opendaw/lib-midi"
import {Promises} from "@opendaw/lib-runtime"
import {Files} from "@opendaw/lib-dom"
import {NoteEventCollectionBoxAdapter} from "@opendaw/studio-adapters"

export namespace NoteMidiExport {
    export const fromCollection = <E extends NoteEvent>(collection: EventCollection<E>): MidiTrack => {
        const events: Array<ControlEvent> = []
        const toTicks = (position: ppqn, timeDivision: int = 96): int => Math.floor(position / PPQN.Quarter * timeDivision)
        for (const event of collection.asArray()) {
            if (event.velocity <= 0 || event.duration <= 0) {continue}
            const start = toTicks(event.position)
            const end = Math.max(start + 1, toTicks(EventSpan.complete(event)))
            const velocity = Math.max(1, Math.min(127, Math.round(event.velocity * 127)))
            events.push(new ControlEvent(start, ControlType.NOTE_ON, event.pitch, velocity))
            events.push(new ControlEvent(end, ControlType.NOTE_OFF, event.pitch, 0))
        }
        return new MidiTrack(new ArrayMultimap<Channel, ControlEvent>([[0, events]], (left, right) =>
            ControlEvent.Comparator(left, right) ||
            Number(left.type !== ControlType.NOTE_OFF) - Number(right.type !== ControlType.NOTE_OFF)), [])
    }

    export const toFile = async (collection: NoteEventCollectionBoxAdapter, suggestedName: string = "notes.mid") => {
        const encoder = MidiFile.encoder()
        encoder.addTrack(fromCollection(collection.events))
        return Promises.tryCatch(Files.save(encoder.encode().toArrayBuffer() as ArrayBuffer, {
            types: [{
                description: "Midi File",
                accept: {"application/octet-stream": [".mid", ".midi"]}
            }], suggestedName
        }))
    }
}
