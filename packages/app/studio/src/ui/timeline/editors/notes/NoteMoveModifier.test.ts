import {expect, it, vi} from "vitest"
import {Editing, Option, Selection} from "@opendaw/lib-std"
import {NoteEventBoxAdapter, NoteEventCollectionBoxAdapter} from "@opendaw/studio-adapters"
import {Dragging} from "@opendaw/lib-dom"
import {EventCollection} from "@opendaw/lib-dsp"
import {createNotePitchPainter} from "./pitch/PitchPainter"
import {NoteMoveModifier} from "./NoteMoveModifier"

vi.mock("@/ui/timeline/editors/TimeGridRenderer.ts", () => ({renderTimeGrid() {}}))

const setup = (pitches: number[]) => {
    const collection = {box: {events: {}, isAttached: () => true}} as unknown as NoteEventCollectionBoxAdapter
    const copies: {pitch: number, position: number}[] = []
    const notes = pitches.map(initial => {
        let pitch = initial, position = 100, attached = true
        const adapter = {get isSelected() {return selected.includes(adapter as unknown as NoteEventBoxAdapter)},
            chance: 1, velocity: 1, playCount: 1, get pitch() {return pitch}, get position() {return position},
            get complete() {return position + 10}, duration: 10, collection: Option.wrap(collection),
            copyTo: vi.fn((value: {pitch: number, position: number}) => {copies.push(value); return adapter}),
            box: {isAttached: () => attached, pitch: {setValue: (value: number) => {pitch = value}},
                position: {setValue: (value: number) => {position = value}}}}
        return {adapter: adapter as unknown as NoteEventBoxAdapter, remove: () => {attached = false}}
    })
    let selected = notes.slice(0, -1).map(note => note.adapter)
    const selection = {selected: () => selected, deselectAll: () => {selected = []},
        select: (...notes: NoteEventBoxAdapter[]) => {selected.push(...notes)}} as unknown as Selection<NoteEventBoxAdapter>
    const construct = {editing: Editing.Transient, element: document.createElement("canvas"), selection,
        pointerPulse: 0, pointerPitch: pitches[0], reference: notes[0].adapter,
        positioner: {yToPitch: (y: number) => y}, snapping: {computeDelta: (_pulse: number, x: number) => x}}
    const tool = NoteMoveModifier.create(construct as unknown as Parameters<typeof NoteMoveModifier.create>[0])
    const audition: number[] = []
    tool.subscribePitchChanged(pitch => audition.push(pitch))
    const move = (pitch: number, copy = false, repeat = false, x = 10) => tool.update({clientX: x, clientY: pitch,
        ctrlKey: copy, shiftKey: repeat, altKey: false} as Dragging.Event)
    return {notes, tool, move, copies, audition, select: (indexes: number[]) => {selected = indexes.map(i => notes[i].adapter)}}
}

it.each([false, true])("owns the original surviving notes across selection changes; copy=%s", copy => {
    const h = setup([60, 64, 67, 72])
    h.select([3])
    h.notes[1].remove()
    h.move(61, copy)
    expect(h.tool.isSelected(h.notes[0].adapter)).toBe(true)
    expect(h.tool.isSelected(h.notes[3].adapter)).toBe(false)
    expect(h.tool.selectedModifyStrategy().readPitch(h.notes[0].adapter)).toBe(61)
    expect(h.tool.selectedModifyStrategy().readPitch(h.notes[3].adapter)).toBe(72)
    h.tool.approve()
    if (copy) {
        expect(h.copies.map(note => note.pitch)).toEqual([61, 68])
    } else {
        expect(h.notes.map(note => note.adapter.pitch)).toEqual([61, 64, 68, 72])
        expect(h.notes.map(note => note.adapter.position)).toEqual([110, 100, 110, 100])
    }
})

it.each([false, true])("copies surviving notes when the reference retires; copy=%s", copy => {
    const h = setup([60, 64, 72])
    h.notes[0].remove()
    h.move(61, copy)
    h.tool.approve()
    expect(h.notes[0].adapter.pitch).toBe(60)
    if (copy) {expect(h.copies.map(note => note.pitch)).toEqual([65])}
    else {expect(h.notes[1].adapter.pitch).toBe(65)}
})

it.each([false, true])("preserves low/high chord intervals in preview and approval; copy=%s", copy => {
    for (const [pitches, pointer, expected] of [
        [[0, 4, 90], -10, [0, 4]], [[123, 127, 90], 140, [123, 127]],
        [[2, 6, 90], -10, [0, 4]], [[121, 125, 90], 140, [123, 127]]
    ] as const) {
        const h = setup([...pitches])
        h.move(pointer, copy)
        const preview = h.notes.slice(0, 2).map(note => h.tool.selectedModifyStrategy().readPitch(note.adapter))
        expect(preview).toEqual(expected)
        expect(h.audition.every(pitch => pitch >= 0 && pitch <= 127)).toBe(true)
        h.tool.approve()
        expect(copy ? h.copies.map(note => note.pitch) : h.notes.slice(0, 2).map(note => note.adapter.pitch)).toEqual(expected)
    }
})

it.each([0, 127])("keeps audition in the MIDI domain and suppresses repeated edge notifications: %s", pitch => {
    const h = setup([pitch, 60])
    const direction = pitch === 0 ? -1 : 1
    h.move(pitch + direction, false, false, 0)
    h.move(pitch + 2 * direction, false, false, 0)
    expect(h.audition).toEqual([])
    expect(h.tool.selectedModifyStrategy().readPitch(h.notes[0].adapter)).toBe(pitch)
    h.move(pitch - direction, false, false, 0)
    h.move(pitch + direction, false, false, 0)
    h.move(pitch + 3 * direction, false, false, 0)
    expect(h.audition).toEqual([pitch - direction, pitch])
    h.tool.approve()
    expect(h.notes[0].adapter.pitch).toBe(pitch)
})

it("repeat-copy uses the same shared pitch delta", () => {
    const h = setup([2, 6, 90])
    h.move(-10, true, true)
    h.tool.approve()
    expect(h.copies.map(note => note.pitch)).toEqual([0, 4])
})

it("paints both copy origins and owned previews after selection replacement", () => {
    vi.stubGlobal("devicePixelRatio", 1)
    try {
        const h = setup([2, 6, 90])
        h.select([2])
        h.move(-10, true)
        const events = EventCollection.create<NoteEventBoxAdapter>()
        h.notes.forEach(note => events.add(note.adapter))
        const fillRect = vi.fn()
        const context = {canvas: {width: 600, height: 100}, fillRect}
        const construct = {canvas: {clientHeight: 100}, positioner: {yToPitch: () => 60, pitchToY: (pitch: number) => pitch * 10, noteHeight: 10},
            range: {unitToX: (unit: number) => unit, unitMin: 0, unitMax: 1000, unitPadding: 0},
            scale: {has: () => false}, snapping: {}, modifyContext: {modifier: Option.wrap(h.tool)},
            reader: {offset: 0, hue: 0, contentDuration: 1000, timelineBoxAdapter: {}, content: {events, maxDuration: 10}}}
        const paint = createNotePitchPainter(construct as unknown as Parameters<typeof createNotePitchPainter>[0])
        paint({context, actualHeight: 100} as unknown as Parameters<typeof paint>[0])
        const outlines = fillRect.mock.calls.filter(call => call[3] === 11).map(call => call.slice(0, 2))
        expect(outlines).toEqual(expect.arrayContaining([[100, 19], [100, 59], [110, -1], [110, 39], [100, 899]]))
        expect(outlines).toHaveLength(5)
    } finally {vi.unstubAllGlobals()}
})
