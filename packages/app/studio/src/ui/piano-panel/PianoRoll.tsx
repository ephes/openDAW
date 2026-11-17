import css from "./PianoRoll.sass?inline"
import {Html} from "@opendaw/lib-dom"
import {createElement, Group} from "@opendaw/lib-jsx"
import {PianoRollLayout} from "@/ui/PianoRollLayout.ts"
import {isDefined, isInstanceOf, Lifecycle, Notifier} from "@opendaw/lib-std"
import {ppqn} from "@opendaw/lib-dsp"
import {NoteRegionBoxAdapter} from "@opendaw/studio-adapters"
import {StudioService} from "@/service/StudioService"

const className = Html.adoptStyleSheet(css, "PianoRoll")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    updateNotifier: Notifier<void>
}

export const PianoRoll = ({lifecycle, service, updateNotifier}: Construct) => {
    const {project} = service
    const {engine, rootBoxAdapter: {pianoMode: {keyboard, transpose}}} = project
    const position = engine.position
    const getPianoLayout = () => PianoRollLayout.getByIndex(keyboard.getValue())
    const createSVG = (): SVGSVGElement => {
        const pianoLayout = getPianoLayout()
        const {sizes: {whiteKeys, blackKeys}} = pianoLayout
        return (
            <svg classList={className}
                 viewBox={`0.5 0 ${pianoLayout.whiteKeys.length * whiteKeys.width - 1} ${(whiteKeys.height)}`}
                 width="100%">
                {pianoLayout.whiteKeys.map(({key, x}) => (
                    <rect classList="white" data-key={key} x={x + 0.5} y={0}
                          width={whiteKeys.width - 1} height={whiteKeys.height}/>
                ))}
                {pianoLayout.blackKeys.map(({key, x}) => (
                    <rect classList="black" data-key={key} x={x} y={2}
                          width={blackKeys.width} height={blackKeys.height} rx={4} ry={4}/>
                ))}
            </svg>
        )
    }
    let svg: SVGSVGElement = createSVG()
    const update = (position: ppqn) => {
        svg.querySelectorAll<SVGRectElement>("rect.playing")
            .forEach(rect => {
                rect.style.removeProperty("fill")
                rect.classList.remove("playing")
            })
        const pianoLayout = getPianoLayout()
        project.rootBoxAdapter.audioUnits.adapters().forEach(audioUnitAdapter => {
            const trackBoxAdapters = audioUnitAdapter.tracks.values()
                .filter(adapter => !adapter.box.excludePianoMode.getValue())
            trackBoxAdapters
                .forEach(trackAdapter => {
                    const region = trackAdapter.regions.collection.lowerEqual(position)
                    if (region === null || !isInstanceOf(region, NoteRegionBoxAdapter) || position >= region.complete) {
                        return
                    }
                    const collection = region.optCollection.unwrap()
                    const events = collection.events
                    if (!(region.loopDuration > 0) || !Number.isFinite(region.loopDuration)) {return}
                    const offset = region.position - region.loopOffset
                    const cycleStart = offset + Math.floor((position - offset) / region.loopDuration) * region.loopDuration
                    const localPosition = position - cycleStart
                    // The event index is half-open. Search through the next integer
                    // tick, then apply the exact inclusive-onset/exclusive-end test.
                    for (const note of events.iterateRange(Math.floor(localPosition) - collection.maxDuration,
                        Math.floor(localPosition) + 1)) {
                        if (note.position <= localPosition && localPosition < note.complete) {
                            const pitch = note.pitch + transpose.getValue()
                            if (pitch < pianoLayout.min || pitch > pianoLayout.max) {continue}
                            const rect = svg.querySelector<SVGRectElement>(`[data-key="${pitch}"]`)
                            if (isDefined(rect)) {
                                rect.style.fill = pianoLayout.getFillStyle(region.hue, true)
                                rect.classList.add("playing")
                            }
                        }
                    }
                })
        })
    }
    const placeholder: Element = <Group>{svg}</Group>
    lifecycle.ownAll(
        keyboard.subscribe(() => {
            svg.remove()
            svg = createSVG()
            placeholder.appendChild(svg)
            update(position.getValue())
        }),
        updateNotifier.subscribe(() => update(position.getValue()))
    )
    update(position.getValue())
    return placeholder
}