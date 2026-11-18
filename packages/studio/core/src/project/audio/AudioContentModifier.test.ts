import {afterEach, expect, it, vi} from "vitest"
import {Interpolation, LoopableRegion, PPQN, TimeBase} from "@opendaw/lib-dsp"
import {RuntimeNotifier, Terminable, UUID} from "@opendaw/lib-std"
import {AudioRegionBoxAdapter, InterpolationFieldAdapter, TrackType} from "@opendaw/studio-adapters"
import {
    AudioFileBox, AudioPitchStretchBox, AudioRegionBox, TrackBox, ValueEventBox, ValueEventCollectionBox
} from "@opendaw/studio-boxes"
import {Workers} from "../../Workers"
import {Project} from "../Project"
import {ProjectEnv} from "../ProjectEnv"
import {AudioContentHelpers} from "./AudioContentHelpers"
import {AudioContentModifier} from "./AudioContentModifier"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})

let project: Project
afterEach(() => project.terminate())

const setup = (duration: number, offset: number, varyingTempo = false, loopDuration = PPQN.Bar) => {
    project = Project.new({sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    const {editing, boxGraph, timelineBox} = project
    const box = editing.modify(() => {
        timelineBox.bpm.setValue(120)
        const track = TrackBox.create(boxGraph, UUID.generate(), track => {
            track.type.setValue(TrackType.Audio)
            track.tracks.refer(project.primaryAudioUnitBox.tracks)
            track.target.refer(project.primaryAudioUnitBox)
        })
        const file = AudioFileBox.create(boxGraph, UUID.generate(), file => file.endInSeconds.setValue(4))
        const events = ValueEventCollectionBox.create(boxGraph, UUID.generate())
        if (varyingTempo) {
            timelineBox.tempoTrack.enabled.setValue(true)
            const tempo = timelineBox.tempoTrack.events.targetVertex.unwrap().box as ValueEventCollectionBox
            for (const [position, value] of [[0, 120], [PPQN.Quarter, 240]]) {
                ValueEventBox.create(boxGraph, UUID.generate(), event => {
                    event.events.refer(tempo.events)
                    event.position.setValue(position)
                    event.value.setValue(value)
                    InterpolationFieldAdapter.write(event.interpolation, Interpolation.None)
                })
            }
        }
        const mode = AudioPitchStretchBox.create(boxGraph, UUID.generate())
        AudioContentHelpers.addDefaultWarpMarkers(boxGraph, mode, PPQN.Bar, 2)
        return AudioRegionBox.create(boxGraph, UUID.generate(), region => {
            region.regions.refer(track.regions)
            region.file.refer(file)
            region.events.refer(events.owners)
            region.playMode.refer(mode)
            region.duration.setValue(duration)
            region.loopDuration.setValue(loopDuration)
            region.loopOffset.setValue(offset)
            region.waveformOffset.setValue(0.25)
        })
    }).unwrap()
    return {box, region: project.boxAdapters.adapterFor(box, AudioRegionBoxAdapter)}
}

it("retains a half-loop trim through a real tempo change", async () => {
    const duration = PPQN.Bar / 2
    const {box, region} = setup(duration, 0, true)
    const {editing, tempoMap} = project
    const beforeSeconds = tempoMap.intervalToSeconds(region.position, region.complete)
    expect(beforeSeconds).toBeCloseTo(0.75)
    editing.modify(await AudioContentModifier.toNotStretched([region]))
    expect(box.timeBase.getValue()).toBe(TimeBase.Seconds)
    expect(box.duration.getValue()).toBeCloseTo(beforeSeconds)
    expect(region.duration).toBeCloseTo(duration)
    expect(box.loopDuration.getValue()).toBe(2)
    expect(editing.undo()).toBe(true)
    expect(box.duration.getValue()).toBe(duration)
    expect(region.asPlayModePitchStretch.nonEmpty()).toBe(true)
})

it("retains a repeated region, its loop phase and source reset after serialization", async () => {
    const {box, region} = setup(PPQN.Bar * 2 + PPQN.Quarter, PPQN.Quarter)
    const {editing, tempoMap} = project
    editing.modify(await AudioContentModifier.toNotStretched([region]))
    expect(box.duration.getValue()).toBe(4.5)
    expect(box.loopDuration.getValue()).toBe(2)
    const passes = Array.from(LoopableRegion.locateLoops(region, region.position, region.complete))
    expect(passes.map(pass => tempoMap.intervalToSeconds(pass.rawStart, pass.resultStart)
        + region.waveformOffset.getValue())).toEqual([0.75, 0.25, 0.25])
    expect(passes.map(pass => tempoMap.intervalToSeconds(pass.rawStart, pass.resultEnd)
        + region.waveformOffset.getValue())).toEqual([2.25, 2.25, 1.25])
    const reopened = project.copy()
    try {
        const restored = reopened.boxGraph.findBox(box.address.uuid).unwrap() as AudioRegionBox
        expect(restored.duration.getValue()).toBe(4.5)
        expect(restored.loopDuration.getValue()).toBe(2)
        expect(restored.loopOffset.getValue()).toBe(PPQN.Quarter)
    } finally {
        reopened.terminate()
    }
})

it("keeps the silent tail of a loop extended past the last warp marker", async () => {
    const {box, region} = setup(PPQN.Bar * 3, PPQN.Bar + PPQN.Quarter, false, PPQN.Bar * 2)
    const {editing, tempoMap} = project
    editing.modify(await AudioContentModifier.toNotStretched([region]))
    expect(box.timeBase.getValue()).toBe(TimeBase.Seconds)
    expect(box.duration.getValue()).toBe(6)
    expect(box.loopDuration.getValue()).toBe(4)
    expect(box.loopOffset.getValue()).toBe(PPQN.Bar + PPQN.Quarter)
    const passes = Array.from(LoopableRegion.locateLoops(region, region.position, region.complete))
    expect(passes.map(pass => tempoMap.intervalToSeconds(pass.rawStart, pass.resultStart)
        + region.waveformOffset.getValue())).toEqual([2.75, 0.25, 0.25])
    expect(editing.undo()).toBe(true)
    expect(box.loopDuration.getValue()).toBe(PPQN.Bar * 2)
    expect(region.asPlayModePitchStretch.nonEmpty()).toBe(true)
})

it("keeps the silent lead-in of a loop that starts before the first warp marker", async () => {
    const {box, region} = setup(PPQN.Bar, 0)
    const first = region.asPlayModePitchStretch.unwrap().warpMarkers.first()
    expect(first).not.toBeNull()
    project.editing.modify(() => first?.box.position.setValue(PPQN.Quarter))
    project.editing.modify(await AudioContentModifier.toNotStretched([region]))
    expect(box.timeBase.getValue()).toBe(TimeBase.Seconds)
    expect(box.duration.getValue()).toBe(2.5)
    expect(box.loopDuration.getValue()).toBe(2.5)
    expect(box.loopOffset.getValue()).toBe(0)
    expect(box.waveformOffset.getValue()).toBe(-0.25)
    expect(project.tempoMap.intervalToSeconds(region.position, region.position + PPQN.Quarter)
        + region.waveformOffset.getValue()).toBe(0.25)
})

it("normalizes a stored loop phase beyond the loop span like playback does", async () => {
    const {box, region} = setup(PPQN.Bar * 2 + PPQN.Quarter, PPQN.Bar * 3 + PPQN.Quarter)
    const {editing, tempoMap} = project
    const before = Array.from(LoopableRegion.locateLoops(region, region.position, region.complete))
        .map(pass => pass.resultStart - pass.rawStart)
    editing.modify(await AudioContentModifier.toNotStretched([region]))
    expect(box.loopOffset.getValue()).toBe(PPQN.Quarter)
    expect(box.loopDuration.getValue()).toBe(2)
    const passes = Array.from(LoopableRegion.locateLoops(region, region.position, region.complete))
    expect(passes.map(pass => tempoMap.intervalToSeconds(pass.rawStart, pass.resultStart)
        + region.waveformOffset.getValue())).toEqual([0.75, 0.25, 0.25])
    expect(before).toEqual([PPQN.Quarter, 0, 0])
})

it("closes transient detection progress when sample loading fails", async () => {
    const {region} = setup(PPQN.Bar, 0)
    const terminate = vi.fn()
    const progress = vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({message: "", terminate})
    const worker = vi.spyOn(Workers, "Transients", "get").mockReturnValue({detect: vi.fn()})
    const audioData = vi.spyOn(region.file, "audioData", "get").mockRejectedValue(new Error("synthetic load failure"))
    try {
        await expect(AudioContentModifier.toTimeStretch([region])).rejects.toThrow("synthetic load failure")
        expect(terminate).toHaveBeenCalledTimes(1)
        expect(region.asPlayModePitchStretch.nonEmpty()).toBe(true)
    } finally {
        progress.mockRestore()
        audioData.mockRestore()
        worker.mockRestore()
    }
})
