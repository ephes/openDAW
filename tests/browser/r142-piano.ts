import {assert, DefaultObservableValue, Notifier, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {Project, ProjectEnv} from "@opendaw/studio-core"
import {AudioUnitBox, CaptureMidiBox, NoteEventBox, NoteEventCollectionBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {AudioUnitType} from "@opendaw/studio-enums"
import {TrackType} from "@opendaw/studio-adapters"
import {PianoRoll} from "@/ui/piano-panel/PianoRoll"
import {PianoRollLayout} from "@/ui/PianoRollLayout"
import type {StudioService} from "@/service/StudioService"

export const piano = (layouts: boolean) => {
    const project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    const lifecycle = new Terminator(), updateNotifier = new Notifier<void>()
    const position = new DefaultObservableValue(0)
    const {editing, boxGraph, rootBoxAdapter: {pianoMode: {keyboard}}} = project
    editing.modify(() => {
        const capture = CaptureMidiBox.create(boxGraph, UUID.generate())
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => {
            box.type.setValue(AudioUnitType.Instrument); box.capture.refer(capture)
            box.collection.refer(project.rootBox.audioUnits); box.output.refer(project.primaryAudioBusBox.input)
        })
        const track = TrackBox.create(boxGraph, UUID.generate(), box => {
            box.type.setValue(TrackType.Notes); box.tracks.refer(unit.tracks); box.target.refer(unit)
        })
        const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
        NoteRegionBox.create(boxGraph, UUID.generate(), box => {
            box.regions.refer(track.regions); box.events.refer(collection.owners)
            box.position.setValue(0); box.duration.setValue(350); box.loopDuration.setValue(100)
        })
        for (const [onset, pitch] of [[0, 60], [20, 64]]) {
            NoteEventBox.create(boxGraph, UUID.generate(), box => {
                box.events.refer(collection.events); box.position.setValue(onset)
                box.duration.setValue(10); box.pitch.setValue(pitch)
            })
        }
        if (layouts) {keyboard.setValue(1000)}
    })
    const service = {project: {rootBoxAdapter: project.rootBoxAdapter, engine: {position}}} as StudioService
    try {
        const panel = PianoRoll({lifecycle, service, updateNotifier})
        document.body.append(panel)
        const seek = (value: number, pitch: number, expected: boolean) => {
            position.setValue(value); updateNotifier.notify()
            assert(panel.querySelector(`[data-key="${pitch}"]`)!.classList.contains("playing") === expected, `pitch ${pitch} at ${value}`)
        }
        if (layouts) {
            for (const index of [-1, 4, 1000, 0, 1, 2, 3]) {
                editing.modify(() => keyboard.setValue(index))
                updateNotifier.notify()
                const layout = PianoRollLayout.getByIndex(index)
                assert(panel.querySelectorAll("rect").length === layout.count, `layout ${index}`)
                assert(keyboard.getValue() === index, "no stored value rewrite")
                seek(0, 60, true)
            }
            editing.undo(); updateNotifier.notify()
            assert(panel.querySelectorAll("rect").length === PianoRollLayout.getByIndex(keyboard.getValue()).count, "layout undo")
        } else {
            for (const cycle of [0, 100, 200]) {
                for (const onset of [0, 20]) {
                    const pitch = onset === 0 ? 60 : 64
                    seek(cycle + onset, pitch, true)
                    seek(cycle + onset + 0.25, pitch, true)
                    seek(cycle + onset + 10, pitch, false)
                }
            }
            const region = boxGraph.boxes().find(box => box instanceof NoteRegionBox) as NoteRegionBox
            editing.modify(() => region.loopOffset.setValue(20))
            seek(0, 64, true); seek(10, 64, false)
            seek(80, 60, true); seek(100, 64, true)
            seek(350, 64, false)
        }
        panel.remove()
    } finally {lifecycle.terminate(); project.terminate()}
}
