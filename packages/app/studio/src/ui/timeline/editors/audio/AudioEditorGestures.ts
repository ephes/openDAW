import {Editing, Option} from "@opendaw/lib-std"
import {EventCollection, PPQN} from "@opendaw/lib-dsp"
import {AudioRegionBox} from "@opendaw/studio-boxes"
import {Dragging} from "@opendaw/lib-dom"
import {TimelineRange} from "@opendaw/studio-core"
import {WarpMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {AudioEventOwnerReader} from "@/ui/timeline/editors/EventOwnerReader.ts"
import {ProvisionalFieldEdit} from "@/ui/timeline/editors/audio/ProvisionalFieldEdit"

export namespace AudioEditorGestures {
    export type Construct = {
        editing: Editing
        range: TimelineRange
        snapping: Snapping
        reader: AudioEventOwnerReader
    }

    export const unitToSeconds = (ppqn: number, warpMarkers: EventCollection<WarpMarkerBoxAdapter>): number => {
        const first = warpMarkers.first()
        const last = warpMarkers.last()
        if (first === null || last === null) {return 0.0}
        // Before the first marker: extrapolate backwards
        if (ppqn < first.position) {
            const second = warpMarkers.greaterEqual(first.position + 1)
            if (second === null) {return first.seconds}
            const rate = (second.seconds - first.seconds) / (second.position - first.position)
            return first.seconds + (ppqn - first.position) * rate
        }
        // After last marker: extrapolate forwards
        if (ppqn > last.position) {
            const secondLast = warpMarkers.lowerEqual(last.position - 1)
            if (secondLast === null) {return last.seconds}
            const rate = (last.seconds - secondLast.seconds) / (last.position - secondLast.position)
            return last.seconds + (ppqn - last.position) * rate
        }
        // Within range: find bracketing markers directly
        const w0 = warpMarkers.lowerEqual(ppqn)
        const w1 = warpMarkers.greaterEqual(ppqn)
        if (w0 === null || w1 === null) {return last.seconds}
        if (w0.position === w1.position) {return w0.seconds}
        const t = (ppqn - w0.position) / (w1.position - w0.position)
        return w0.seconds + t * (w1.seconds - w0.seconds)
    }

    export const resizeLoop = ({editing, range, snapping, reader}: Construct,
                               startEvent: Dragging.Event): Option<Dragging.Process> => {
        const {audioContent: {canResize, box}} = reader
        if (!canResize) {return Option.None}
        const startPPQN = range.xToUnit(startEvent.clientX)
        const beginPPQN = reader.loopDuration
        const minimum = beginPPQN > 0 ? Math.min(PPQN.SemiQuaver, beginPPQN) : PPQN.SemiQuaver
        const edit = new ProvisionalFieldEdit(editing, box instanceof AudioRegionBox ? box.loopDuration : box.duration)
        return Option.wrap({
            update: (event: Dragging.Event) => {
                const delta = snapping.computeDelta(startPPQN, event.clientX, beginPPQN)
                edit.write(() => reader.contentDuration = Math.max(minimum, beginPPQN + delta))
            },
            approve: () => edit.approve(),
            cancel: () => edit.cancel()
        })
    }

    export const slipWaveform = ({editing, range, reader}: Construct, element: Element,
                                 startEvent: Dragging.Event): Option<Dragging.Process> => {
        const {audioContent: {file, observableOptPlayMode, waveformOffset, box}} = reader
        const rect = element.getBoundingClientRect()
        const startX = startEvent.clientX - rect.left
        const startOffset = waveformOffset.getValue()
        const startPPQN = range.xToUnit(startX) - reader.offset
        const optWarping = observableOptPlayMode.map(optPlayMode => optPlayMode.warpMarkers)
        const startAudioSeconds = optWarping.match({
            none: () => {
                // NoSync: linear mapping based on loop duration ratio
                const audioDuration = file.endInSeconds - file.startInSeconds
                const ratio = audioDuration / reader.loopDuration
                return startPPQN * ratio + startOffset
            },
            some: (warpMarkers) => unitToSeconds(startPPQN, warpMarkers) + startOffset
        })
        const edit = new ProvisionalFieldEdit(editing, box.waveformOffset)
        return Option.wrap({
            update: (event: Dragging.Event) => {
                const currentX = event.clientX - rect.left
                const currentPPQN = range.xToUnit(currentX) - reader.offset
                const currentAudioSecondsWithoutOffset = optWarping.match({
                    none: () => {
                        const audioDuration = file.endInSeconds - file.startInSeconds
                        const ratio = audioDuration / reader.loopDuration
                        return currentPPQN * ratio
                    },
                    some: (warpMarkers) => unitToSeconds(currentPPQN, warpMarkers)
                })
                const newOffset = startAudioSeconds - currentAudioSecondsWithoutOffset
                edit.write(() => waveformOffset.setValue(newOffset))
            },
            approve: () => edit.approve(),
            cancel: () => edit.cancel()
        })
    }
}
