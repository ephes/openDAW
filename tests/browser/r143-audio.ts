import {AnimationFrame, Dragging} from "@opendaw/lib-dom"
import {PPQN} from "@opendaw/lib-dsp"
import {
    audioGestureFixture,
    AudioGestureKind,
    AudioGestureOwner
} from "@/ui/timeline/editors/audio/AudioEditorGestures.test-fixture"

export const setup = (owner: AudioGestureOwner, gesture: AudioGestureKind) => {
    AnimationFrame.start(window)
    const canvas = document.createElement("canvas")
    canvas.style.cssText = "position:fixed;left:0;top:0;width:1000px;height:200px"
    document.body.append(canvas)
    const fixture = audioGestureFixture(owner)
    const start = gesture === "resize" ? PPQN.Bar : PPQN.Quarter
    const dragging = Dragging.attach(canvas, event => fixture.factory(gesture, event, canvas),
        {permanentUpdates: gesture === "resize"})
    const before = fixture.read()
    return {
        points: {start: fixture.at(start).clientX, move: fixture.at(start + PPQN.Quarter * 2).clientX},
        read: () => ({values: fixture.read(), before}),
        undo: () => fixture.editing.undo(),
        dispose: () => dragging.terminate(),
        close: () => {dragging.terminate(); fixture.close(); canvas.remove()}
    }
}
