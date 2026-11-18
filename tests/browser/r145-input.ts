import {Terminator} from "@opendaw/lib-std"
import {Project} from "@opendaw/studio-core"
import {noteGestureFixture} from "@/ui/timeline/editors/notes/NoteGesture.test-fixture"
import {NoteModifier} from "@/ui/timeline/editors/notes/NoteModifier"
import {ObservableModifyContext} from "@/ui/timeline/ObservableModifyContext"
import {PropertyTable} from "@/ui/timeline/editors/notes/property/PropertyTable"
import {AudioEditorHeader} from "@/ui/timeline/editors/audio/AudioEditorHeader"
import {audioGestureFixture} from "@/ui/timeline/editors/audio/AudioEditorGestures.test-fixture"

export const numberInput = () => {
    const fixture = audioGestureFixture("region")
    const {editing, reader} = fixture
    const control = AudioEditorHeader({lifecycle: new Terminator(), project: {editing} as Project, reader})
    control.id = "numeric-editor"
    document.body.append(control)
    return () => reader.audioContent.waveformOffset.getValue()
}

export const timeCode = () => {
    const {editing, selection, notes} = noteGestureFixture()
    selection.deselectAll()
    selection.select(notes[0])
    const control = PropertyTable({editing, selection, lifecycle: new Terminator(),
        modifyContext: new ObservableModifyContext<NoteModifier>()})
    control.id = "note-properties"
    const outside = document.createElement("button")
    outside.textContent = "Outside properties"
    document.body.append(control, outside)
    return () => ({position: notes[0].position, duration: notes[0].duration})
}
