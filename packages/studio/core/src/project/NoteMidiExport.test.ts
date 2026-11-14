import {expect, it} from "vitest"
import {EventCollection, NoteEvent, PPQN} from "@opendaw/lib-dsp"
import {ControlEvent, MidiFile} from "@opendaw/lib-midi"
import {NoteMidiExport} from "./NoteMidiExport"

const tick = PPQN.Quarter / 96
const note = (position: number, duration: number, velocity = 0.5, pitch = 60): NoteEvent => ({
    type: "note-event", position: position * tick, duration: duration * tick, velocity, pitch, cent: 0
})
const roundTrip = (notes: NoteEvent[]): ControlEvent[] => {
    const collection = EventCollection.create<NoteEvent>(NoteEvent.Comparator)
    notes.forEach(event => collection.add(event))
    const bytes = MidiFile.encoder().addTrack(NoteMidiExport.fromCollection(collection)).encode().toArrayBuffer() as ArrayBuffer
    const events: ControlEvent[] = []
    MidiFile.decoder(bytes).decode().tracks[0].controlEvents.forEach((_channel, controls) => events.push(...controls))
    return events
}
const replay = (notes: NoteEvent[]) => {
    const heard: Array<{ticks: number, type: "on" | "off", pitch: number, velocity?: number}> = []
    roundTrip(notes).forEach(event => event.accept({
        noteOn: (pitch, velocity) => heard.push({ticks: event.ticks, type: "on", pitch, velocity}),
        noteOff: pitch => heard.push({ticks: event.ticks, type: "off", pitch})
    }))
    return heard
}

it("exports a positive sub-tick note for at least one MIDI tick", () => {
    const heard = replay([note(0.1, 0.1)])
    expect(heard.map(({type, ticks}) => [type, ticks])).toEqual([["on", 0], ["off", 1]])
})
it("keeps a low positive attack audible after 7-bit quantization", () => {
    const heard = replay([note(0, 1, 0.0001)])
    expect(heard[0]).toMatchObject({type: "on", velocity: 1 / 127})
    expect(heard[1]).toMatchObject({type: "off", ticks: 1})
})
it("omits silent and nonpositive-duration notes without emitting accidental releases", () => {
    expect(replay([note(0, 1, 0), note(0, 0), note(0, -1)])).toEqual([])
})
it("ends a previous note before an adjacent same-pitch retrigger", () => {
    const heard = replay([note(1, 0.1), note(0, 0.1)])
    expect(heard.map(({type, ticks}) => [type, ticks])).toEqual([["on", 0], ["off", 1], ["on", 1], ["off", 2]])
})
it("retains overlap endpoints and orders releases before attacks at a shared tick", () => {
    const heard = replay([note(0, 3), note(1, 1), note(2, 1)])
    expect(heard.map(({type, ticks}) => [type, ticks])).toEqual([
        ["on", 0], ["on", 1], ["off", 2], ["on", 2], ["off", 3], ["off", 3]
    ])
})
