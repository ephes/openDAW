import {afterEach, expect, it, vi} from "vitest"
import {PPQN} from "@opendaw/lib-dsp"
import {Integer, Terminator} from "@opendaw/lib-std"
import {NoteEventBox, NoteRegionBox} from "@opendaw/studio-boxes"
import {noteGestureFixture} from "../NoteGesture.test-fixture"
import {NoteModifier} from "../NoteModifier"
import {ObservableModifyContext} from "@/ui/timeline/ObservableModifyContext"
import {PropertyTable} from "./PropertyTable"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "property-test"}}
})

const lifecycle = new Terminator()
afterEach(() => {lifecycle.terminate(); document.body.replaceChildren()})

const setup = () => {
    const fixture = noteGestureFixture()
    lifecycle.own({terminate: fixture.close})
    const {selection, editing, notes, project} = fixture
    editing.modify(() => {
        for (const box of project.boxGraph.boxes()) {
            if (box instanceof NoteRegionBox) {
                box.duration.setValue(PPQN.Bar)
                box.loopDuration.setValue(PPQN.Bar)
            }
        }
    })
    selection.deselectAll()
    selection.select(notes[0])
    const table = PropertyTable({selection, editing, lifecycle, modifyContext: new ObservableModifyContext<NoteModifier>()})
    document.body.append(table)
    const fields = table.querySelectorAll<HTMLElement>("[contenteditable]")
    const enter = (index: number, draft: string) => {
        const input = fields[index]
        input.focus()
        input.textContent = draft
        input.dispatchEvent(new KeyboardEvent("keydown", {code: "Enter", bubbles: true, cancelable: true}))
    }
    return {fixture, fields, enter, note: notes[0].box}
}

it.each([[3, "4294967297"], [3, "17junk"], [3, "1.25"], [3, "2147483648"], [0, "9007199254740991"],
    [7, "-1"], [7, "2147483648"]] as const)("rejects field %s draft %s without touching the graph", (index, draft) => {
    const {fixture, note, fields, enter} = setup()
    const before = new Uint8Array(fixture.project.toArrayBuffer())
    const display = fields[index].textContent
    enter(index, draft)
    expect(note.position.getValue()).toBe(0)
    expect(note.duration.getValue()).toBe(10)
    expect(fields[index].textContent).toBe(display)
    expect(new Uint8Array(fixture.project.toArrayBuffer())).toEqual(before)
    expect(fixture.selection.count()).toBe(1)
})

it.each([Integer.MIN_VALUE, Integer.MAX_VALUE])("persists a boundary position %s", position => {
    const {fixture, note, enter} = setup()
    enter(3, String(position))
    expect(note.position.getValue()).toBe(position)
    enter(7, String(Integer.MAX_VALUE))
    const reopened = fixture.project.copy()
    try {
        const reopenedNote = reopened.boxGraph.findBox(note.address.uuid).unwrap() as NoteEventBox
        expect(reopenedNote.position.getValue()).toBe(position)
        expect(reopenedNote.duration.getValue()).toBe(Integer.MAX_VALUE)
    } finally {
        reopened.terminate()
    }
})

it("commits on blur, restores invalid digits, and reflects one undo per edit", () => {
    const {fixture, fields, enter, note} = setup()
    const ticks = fields[7]
    ticks.focus()
    ticks.textContent = "77"
    fields[3].focus()
    expect(note.duration.getValue()).toBe(77)
    expect(ticks.textContent).toBe("077")
    enter(7, "88")
    ticks.blur()
    expect(note.duration.getValue()).toBe(88)
    expect(fixture.editing.undo()).toBe(true)
    expect(note.duration.getValue()).toBe(77)
    expect(ticks.textContent).toBe("077")
    ticks.focus()
    ticks.textContent = "bad"
    ticks.blur()
    expect(ticks.textContent).toBe("077")
    expect(fixture.editing.undo()).toBe(true)
    expect(note.duration.getValue()).toBe(10)
    expect(ticks.textContent).toBe("010")
})

it("drops a draft when the selected note changes before blur", () => {
    const {fixture, fields, note} = setup()
    const ticks = fields[3]
    ticks.focus()
    ticks.textContent = "77"
    fixture.swap()
    ticks.blur()
    expect(note.position.getValue()).toBe(0)
    expect(fixture.notes[3].position).toBe(6)
    expect(ticks.textContent).toBe("006")
})
