import {expect, it} from "vitest"
import {NoteEvent} from "@opendaw/lib-dsp"
import {NoteEventSource, NoteLifecycleEvent} from "../../NoteEventSource"
import {BlockFlag} from "../../processing"
import {noteChainFixture} from "./note-chain-fixture"

const held = (pitch: number, cent: number): NoteEvent =>
    ({type: "note-event", position: 0, duration: Number.POSITIVE_INFINITY, pitch, velocity: 0.8, cent})

const heldSource = (notes: ReadonlyArray<NoteEvent>): NoteEventSource => ({
    * processNotes() {},
    * iterateActiveNotesAt() {for (const note of notes) {yield {...note}}}
})

const arpeggiate = (notes: ReadonlyArray<NoteEvent>, modeIndex: number) => {
    const arpeggio = noteChainFixture().arpeggio(box => {
        box.modeIndex.setValue(modeIndex)
        box.rateIndex.setValue(12)
    })
    arpeggio.setNoteEventSource(heldSource(notes))
    return [...arpeggio.processNotes(0, 3840, BlockFlag.transporting)]
        .filter(NoteLifecycleEvent.isStart).slice(0, notes.length)
        .map(({pitch, cent}) => ({pitch, cent}))
}

it("preserves the cent detune of arpeggiated notes", () => {
    expect(arpeggiate([held(60, 25), held(64, -30)], 0)).toEqual([{pitch: 60, cent: 25}, {pitch: 64, cent: -30}])
})

it.each([[0, [60, 64, 67]], [1, [67, 64, 60]], [2, [60, 64, 67]]])(
    "orders mode %i by pitch regardless of insertion order", (modeIndex, expected) => {
        const pitches = (notes: ReadonlyArray<NoteEvent>) => arpeggiate(notes, modeIndex).map(({pitch}) => pitch)
        expect(pitches([held(67, 0), held(60, 0), held(64, 0)])).toEqual(expected)
        expect(pitches([held(64, 0), held(67, 0), held(60, 0)])).toEqual(expected)
    })
