import {AnimationFrame, Dragging} from "@opendaw/lib-dom"
import {Terminator, ValueAxis} from "@opendaw/lib-std"
import {SelectionRectangle} from "@/ui/timeline/SelectionRectangle"
import {noteGestureFixture} from "@/ui/timeline/editors/notes/NoteGesture.test-fixture"
import {NotePropertyAccessors} from "@/ui/timeline/editors/notes/property/PropertyAccessor"
import {ObservableModifyContext} from "@/ui/timeline/ObservableModifyContext"
import {NoteModifier} from "@/ui/timeline/editors/notes/NoteModifier"

export const setup = (index: number) => {
    const canvas = document.createElement("canvas")
    canvas.id = "notes"
    canvas.style.cssText = "position:fixed;left:0;top:0;width:600px;height:200px"
    document.body.append(canvas)
    const h = noteGestureFixture(NotePropertyAccessors[index], canvas)
    const context = new ObservableModifyContext<NoteModifier>()
    const owner = Dragging.attach(canvas, () => context.startModifier(h.tool))
    const before = h.read()
    return {
        read: () => ({values: h.read(), preview: h.preview(), before, active: context.modifier.nonEmpty()}),
        swap: () => {h.swap(); h.detach(); h.editing.mark()},
        undo: () => h.editing.undo(),
        close: () => {owner.terminate(); h.close(); canvas.remove()}
    }
}

export const marquee = () => {
    AnimationFrame.start(window)
    const target = document.createElement("div")
    target.style.cssText = "position:fixed;inset:0"
    document.body.append(target)
    const {notes, selection, close} = noteGestureFixture()
    const lifecycle = new Terminator()
    const svg = SelectionRectangle({
        lifecycle, target, selection, xAxis: ValueAxis.Identity, yAxis: ValueAxis.Identity,
        locator: {
            selectableAt: () => [],
            selectable: () => notes,
            selectablesBetween: (begin, end) => notes.filter(note => {
                const x = 100 + note.position * 50
                return x >= begin.u && x <= end.u && begin.v <= 100 && 100 <= end.v
            })
        }
    })
    target.append(svg)
    return {
        read: () => notes.map((note, index) => selection.isSelected(note) ? index : -1).filter(index => index >= 0),
        close: () => {lifecycle.terminate(); close(); target.remove()}
    }
}
