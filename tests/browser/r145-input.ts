import {Terminator} from "@opendaw/lib-std"
import {Project} from "@opendaw/studio-core"
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
