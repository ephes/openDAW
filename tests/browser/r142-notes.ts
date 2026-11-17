import {Dragging} from "@opendaw/lib-dom"
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
