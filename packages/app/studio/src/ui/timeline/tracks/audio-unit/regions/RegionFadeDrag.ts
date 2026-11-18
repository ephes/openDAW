import {Dragging} from "@opendaw/lib-dom"
import {ppqn} from "@opendaw/lib-dsp"
import {clamp, Editing} from "@opendaw/lib-std"
import {ProvisionalFieldEdit} from "@/ui/timeline/editors/audio/ProvisionalFieldEdit"
import {AudioRegionBoxAdapter} from "@opendaw/studio-adapters"

export const regionFadeDrag = ({position, duration, complete, fading, box}: AudioRegionBoxAdapter, isFadeIn: boolean,
                               editing: Editing, toPpqn: (clientX: number) => ppqn): Dragging.Process => {
    const edit = new ProvisionalFieldEdit(editing, box.fading.in, box.fading.out)
    const originalFadeIn = fading.in
    const originalFadeOut = fading.out
    return {
        update: (dragEvent: Dragging.Event) => {
            const pointerPpqn = toPpqn(dragEvent.clientX)
            edit.write(() => {
                if (isFadeIn) {
                    const newFadeIn = clamp(pointerPpqn - position, 0, duration)
                    fading.inField.setValue(newFadeIn)
                    fading.outField.setValue(Math.min(originalFadeOut, duration - newFadeIn))
                } else {
                    const newFadeOut = clamp(complete - pointerPpqn, 0, duration)
                    fading.outField.setValue(newFadeOut)
                    fading.inField.setValue(Math.min(originalFadeIn, duration - newFadeOut))
                }
            })
        },
        approve: () => edit.approve(),
        cancel: () => edit.cancel()
    }
}
