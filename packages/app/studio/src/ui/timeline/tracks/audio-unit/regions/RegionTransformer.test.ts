import {expect, it} from "vitest"
import {BoxEditing, BoxGraph} from "@opendaw/lib-box"
import {DefaultObservableValue, Option, Terminable, UUID} from "@opendaw/lib-std"
import {ConstantTempoMap, TimeBase} from "@opendaw/lib-dsp"
import {AudioClipBoxAdapter, AudioRegionBoxAdapter, BoxAdapters, BoxAdaptersContext, ProjectSkeleton, TimelineBoxAdapter, TrackType, VaryingTempoMap} from "@opendaw/studio-adapters"
import {AudioClipBox, AudioFileBox, AudioPitchStretchBox, AudioRegionBox, AudioTimeStretchBox, AudioUnitBox, BoxIO, CaptureAudioBox, TrackBox, WarpMarkerBox, ValueEventBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {AudioUnitType} from "@opendaw/studio-enums"
import {RegionTransformer} from "./RegionTransformer"

const cases = [TimeBase.Seconds, TimeBase.Musical].flatMap(timeBase =>
    ["native", "pitch", "stretch"].flatMap(mode => [false, true].map(varying => ({timeBase, mode, varying}))))
it.each(cases)("converts native audio duration and source offset through history/reopen ($timeBase, $mode, varying=$varying)", ({timeBase, mode: playMode, varying}) => {
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioBusBox, timelineBox}} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const context = {boxGraph, tempoMap: new ConstantTempoMap(new DefaultObservableValue(120)),
        sampleManager: {getOrCreate: () => ({state: {type: "loaded"}, subscribe: () => Terminable.Empty})}} as unknown as BoxAdaptersContext
    Object.assign(context, {boxAdapters: new BoxAdapters(context)})
    boxGraph.beginTransaction()
    const capture = CaptureAudioBox.create(boxGraph, UUID.generate())
    const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Instrument)
        box.collection.refer(rootBox.audioUnits)
        box.output.refer(primaryAudioBusBox.input)
        box.capture.refer(capture)
    })
    const track = TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(TrackType.Audio); box.tracks.refer(unit.tracks); box.target.refer(unit)
    })
    const file = AudioFileBox.create(boxGraph, UUID.generate())
    const events = ValueEventCollectionBox.create(boxGraph, UUID.generate())
    const mode = playMode === "native" ? Option.None : Option.wrap(playMode === "pitch"
        ? AudioPitchStretchBox.create(boxGraph, UUID.generate()) : AudioTimeStretchBox.create(boxGraph, UUID.generate()))
    mode.ifSome(mode => WarpMarkerBox.create(boxGraph, UUID.generate(), box => box.owner.refer(mode.warpMarkers)))
    if (varying) {
        timelineBox.tempoTrack.enabled.setValue(true)
        const tempoCollection = timelineBox.tempoTrack.events.targetVertex.unwrap().box as ValueEventCollectionBox
        for (const [position, value] of [[0, 120], [7680, 60]]) {
            ValueEventBox.create(boxGraph, UUID.generate(), box => {
                box.events.refer(tempoCollection.events); box.position.setValue(position); box.value.setValue(value)
            })
        }
    }
    const nativeDuration = timeBase === TimeBase.Seconds ? 2 : 3840
    const region = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
        box.regions.refer(track.regions); box.file.refer(file); box.events.refer(events.owners)
        mode.ifSome(mode => box.playMode.refer(mode)); box.position.setValue(7680); box.timeBase.setValue(timeBase)
        box.duration.setValue(nativeDuration); box.loopDuration.setValue(nativeDuration)
        box.waveformOffset.setValue(1.25)
    })
    boxGraph.endTransaction()
    const timeline = context.boxAdapters.adapterFor(timelineBox, TimelineBoxAdapter)
    if (varying) {Object.assign(context, {tempoMap: new VaryingTempoMap(timeline)})}
    const source = context.boxAdapters.adapterFor(region, AudioRegionBoxAdapter)
    const editing = new BoxEditing(boxGraph)
    const clip = editing.modify(() => RegionTransformer.toClip(source, false)).unwrap() as AudioClipBox
    expect(clip.duration.getValue()).toBe(nativeDuration)
    expect(clip.waveformOffset.getValue()).toBe(1.25)
    expect(clip.file.targetVertex.unwrap()).toBe(file)
    expect(clip.playMode.targetVertex.unwrapOrNull()).toBe(mode.unwrapOrNull())
    const rendered = context.boxAdapters.adapterFor(clip, AudioClipBoxAdapter)
    if (timeBase === TimeBase.Seconds) {
        expect(context.tempoMap.intervalToSeconds(0, rendered.duration)).toBeCloseTo(2)
        expect(context.tempoMap.intervalToSeconds(source.position, source.position + source.loopDuration)).toBeCloseTo(2)
    } else {
        expect(rendered.duration).toBe(nativeDuration)
    }
    editing.undo(); expect(boxGraph.findBox(clip.address.uuid).isEmpty()).toBe(true)
    editing.redo()
    const reopened = new BoxGraph(Option.wrap(BoxIO.create))
    reopened.fromArrayBuffer(boxGraph.toArrayBuffer())
    const restored = reopened.findBox(clip.address.uuid).unwrap() as AudioClipBox
    expect(restored.duration.getValue()).toBe(nativeDuration)
    expect(restored.waveformOffset.getValue()).toBe(1.25)
})
