import {DefaultObservableValue, StringMapping, Terminable, Terminator, UUID, ValueMapping} from "@opendaw/lib-std"
import {AudioUnitBox, CaptureMidiBox, NoteEventCollectionBox, NoteRegionBox, TrackBox,
    ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import {AudioUnitType} from "@opendaw/studio-enums"
import {NoteRegionBoxAdapter, TrackType, ValueRegionBoxAdapter} from "@opendaw/studio-adapters"
import {MenuItem, Project, ProjectEnv, TimelineRange} from "@opendaw/studio-core"
import {RegionReader} from "@/ui/timeline/editors/RegionReader"
import {NoteEditor} from "@/ui/timeline/editors/notes/NoteEditor"
import {ValueEditor} from "@/ui/timeline/editors/value/ValueEditor"
import {Snapping} from "@/ui/timeline/Snapping"
import type {StudioService} from "@/service/StudioService"

export const setupEditor = (type: "note" | "value") => {
    const project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    const lifecycle = new Terminator()
    const {boxGraph, editing, boxAdapters} = project
    const region = editing.modify(() => {
        const capture = CaptureMidiBox.create(boxGraph, UUID.generate())
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => {
            box.type.setValue(AudioUnitType.Instrument)
            box.collection.refer(project.rootBox.audioUnits)
            box.output.refer(project.primaryAudioBusBox.input)
            box.capture.refer(capture)
        })
        const track = TrackBox.create(boxGraph, UUID.generate(), box => {
            box.tracks.refer(unit.tracks)
            box.target.refer(unit)
            box.type.setValue(type === "note" ? TrackType.Notes : TrackType.Value)
        })
        if (type === "note") {
            const content = NoteEventCollectionBox.create(boxGraph, UUID.generate())
            return NoteRegionBox.create(boxGraph, UUID.generate(), box => {
                box.events.refer(content.owners); box.regions.refer(track.regions)
            })
        }
        const content = ValueEventCollectionBox.create(boxGraph, UUID.generate())
        return ValueRegionBox.create(boxGraph, UUID.generate(), box => {
            box.events.refer(content.owners); box.regions.refer(track.regions)
        })
    }).unwrap()
    const range = lifecycle.own(new TimelineRange())
    range.width = 600; range.maxUnits = 7680
    const service = {project} as StudioService
    const common = {lifecycle, service, range, snapping: new Snapping(range)}
    const element = region instanceof NoteRegionBox ? NoteEditor({...common,
        menu: {editMenu: MenuItem.root(), viewMenu: MenuItem.root()},
        reader: RegionReader.forNoteRegionBoxAdapter(boxAdapters.adapterFor(region, NoteRegionBoxAdapter), project.timelineBoxAdapter)
    }) : ValueEditor({...common,
        reader: RegionReader.forValueRegionBoxAdapter(boxAdapters.adapterFor(region, ValueRegionBoxAdapter), project.timelineBoxAdapter),
        eventMapping: ValueMapping.unipolar(),
        context: {anchorModel: new DefaultObservableValue(0), valueMapping: ValueMapping.unipolar(),
            stringMapping: StringMapping.percent(), currentValue: 0, floating: false, quantize: value => value}
    })
    element.id = "deferred-editor"
    return {
        attach: () => document.body.append(element),
        retire: () => lifecycle.terminate(),
        close: () => {lifecycle.terminate(); element.remove(); project.terminate()}
    }
}
