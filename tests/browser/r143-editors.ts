import {Terminable, UUID} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import {AnimationFrame} from "@opendaw/lib-dom"
import {Project, ProjectEnv, TimelineRange} from "@opendaw/studio-core"
import {NoteRegionBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {NoteEventCollectionBox, NoteRegionBox, TrackBox} from "@opendaw/studio-boxes"
import {RegionReader} from "@/ui/timeline/editors/RegionReader"
import {listenToRegionTrack} from "@/ui/timeline/editors/RegionTrackListener"

const frames = (count: number) => new Promise<void>(resolve => {
    const step = (remaining: number) => remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1))
    step(count)
})

export const run = async () => {
    AnimationFrame.start(window)
    const project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    const {editing, boxGraph, boxAdapters, timelineBoxAdapter} = project
    const tracks = [0, 1].map(() => editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), track => {
        track.type.setValue(TrackType.Notes)
        track.tracks.refer(project.primaryAudioUnitBox.tracks); track.target.refer(project.primaryAudioUnitBox)
    })).unwrap())
    const addRegion = (track: TrackBox, position: number) => editing.modify(() => {
        const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate())
        return NoteRegionBox.create(boxGraph, UUID.generate(), region => {
            region.events.refer(collection.owners); region.regions.refer(track.regions)
            region.position.setValue(position); region.duration.setValue(PPQN.Bar); region.loopDuration.setValue(PPQN.Bar)
        })
    }).unwrap()
    const box = addRegion(tracks[0], 0)
    const region = boxAdapters.adapterFor(box, NoteRegionBoxAdapter)
    let repaints = 0
    const bound = listenToRegionTrack(region, () => repaints++)
    for (let index = 1; index <= 8; index++) {editing.modify(() => box.regions.refer(tracks[index % 2].regions))}
    repaints = 0
    addRegion(tracks[1], PPQN.Bar * 8)
    const stale = repaints
    repaints = 0
    addRegion(tracks[0], PPQN.Bar * 8)
    const current = repaints
    bound.terminate()
    repaints = 0
    addRegion(tracks[0], PPQN.Bar * 9)
    const closed = repaints
    const range = new TimelineRange({padding: 0})
    range.maxUnits = PPQN.Bar * 64; range.width = 1000; range.showUnitInterval(0, PPQN.Bar * 4)
    const active = RegionReader.forNoteRegionBoxAdapter(region, timelineBoxAdapter).keeoOverlapping(range)
    editing.modify(() => box.position.setValue(PPQN.Bar * 32))
    await frames(4)
    const followed = range.unitMin
    const retired = RegionReader.forNoteRegionBoxAdapter(region, timelineBoxAdapter)
    active.terminate()
    const subscription = retired.keeoOverlapping(range)
    editing.modify(() => box.position.setValue(0))
    subscription.terminate()
    await frames(4)
    const result = {stale, current, closed, followed, after: range.unitMin}
    range.terminate()
    project.terminate()
    return result
}
