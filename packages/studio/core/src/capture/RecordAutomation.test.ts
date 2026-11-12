import {beforeEach, expect, it, vi} from "vitest"
import {Address, BoxEditing} from "@opendaw/lib-box"
import {DefaultObservableValue, Notifier, Option, UUID} from "@opendaw/lib-std"
import {PPQN, ppqn} from "@opendaw/lib-dsp"
import {ParameterWriteEvent, ProjectSkeleton, TrackType} from "@opendaw/studio-adapters"
import {StereoToolDeviceBox, TrackBox, ValueEventBox, ValueRegionBox} from "@opendaw/studio-boxes"
import type {Project} from "../project"
import {RecordAutomation} from "./RecordAutomation"

const clips: Array<[ppqn, ppqn]> = []
vi.mock("../ui", () => ({
    RegionClipResolver: {
        fromRange: (_track: unknown, from: ppqn, to: ppqn) => () => {clips.push([from, to])}
    }
}))

beforeEach(() => {clips.length = 0})

const SQ = PPQN.SemiQuaver

const setup = ({loopFrom, loopTo, allowTakes, position}: {
    loopFrom: ppqn, loopTo: ppqn, allowTakes: boolean, position: ppqn
}) => {
    const {boxGraph, mandatoryBoxes: {primaryAudioUnitBox, timelineBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    editing.modify(() => {
        timelineBox.loopArea.enabled.setValue(true)
        timelineBox.loopArea.from.setValue(loopFrom)
        timelineBox.loopArea.to.setValue(loopTo)
    })
    const device = editing.modify(() => StereoToolDeviceBox.create(boxGraph, UUID.generate(), box =>
        box.host.refer(primaryAudioUnitBox.audioEffects))).unwrap()
    const trackBox = editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(TrackType.Value)
        box.tracks.refer(primaryAudioUnitBox.tracks)
        box.target.refer(device.volume)
    })).unwrap()
    const trackBoxAdapter = {box: trackBox, regions: {collection: {asArray: () => []}}}
    let unitValue = 0.25
    const adapter = {
        address: device.volume.address, name: "Volume", field: device.volume,
        getUnitValue: () => unitValue, valueMapping: {floating: () => false}
    }
    const writes = new Notifier<ParameterWriteEvent>()
    const touchEnds = new Notifier<Address>()
    const parameterFieldAdapters = {
        getTracks: () => Option.wrap({controls: () => Option.wrap(trackBoxAdapter)}),
        isTouched: () => true,
        subscribeWrites: (observer: (event: ParameterWriteEvent) => void) => writes.subscribe(observer),
        subscribeTouchEnd: (observer: (address: Address) => void) => touchEnds.subscribe(observer)
    }
    const engine = {
        position: new DefaultObservableValue<ppqn>(position),
        isRecording: new DefaultObservableValue(true),
        preferences: {settings: {recording: {allowTakes}}}
    }
    const project = {
        boxGraph, editing, engine, timelineBox, parameterFieldAdapters,
        selection: {select: vi.fn(), deselect: vi.fn()}
    } as unknown as Project
    const recording = RecordAutomation.start(project)
    const moveTo = (value: ppqn) => engine.position.setValue(value)
    const write = (value: number) => {
        const previousUnitValue = unitValue
        unitValue = value
        writes.notify({adapter, previousUnitValue} as unknown as ParameterWriteEvent)
    }
    const regions = () => trackBox.regions.pointerHub.incoming()
        .map(({box}) => box as ValueRegionBox)
        .sort((a, b) => a.position.getValue() - b.position.getValue())
    const events = (region: ValueRegionBox) => region.events.targetVertex.unwrap().box.pointerHub.incoming()
        .map(({box}) => (box as ValueEventBox).position.getValue())
        .sort((a, b) => a - b)
    return {recording, moveTo, write, regions, events}
}

it("keeps wrapped automation regions inside a non-quantized loop", () => {
    const loopFrom = 1000, loopTo = 3000
    const f = setup({loopFrom, loopTo, allowTakes: true, position: 1100})
    f.write(0.5)
    f.moveTo(2990)
    f.moveTo(1050)
    f.moveTo(1100)
    const [first, second] = f.regions()
    expect(first.position.getValue()).toBe(loopFrom)
    expect(first.duration.getValue()).toBe(loopTo - loopFrom)
    expect(first.loopDuration.getValue()).toBe(loopTo - loopFrom)
    expect(Math.max(...f.events(first))).toBe(loopTo - loopFrom)
    expect(second.position.getValue()).toBe(loopFrom)
    expect(clips.every(([from, to]) => from >= loopFrom && to <= loopTo)).toBe(true)
    f.recording.terminate()
    expect(f.regions().every(region =>
        region.position.getValue() + region.duration.getValue() <= loopTo)).toBe(true)
})

it("does not treat the first update after an idle loop lap as a loop wrap", () => {
    const loopFrom = 4 * SQ, loopTo = 16 * SQ
    const f = setup({loopFrom, loopTo, allowTakes: true, position: 12 * SQ})
    f.moveTo(15 * SQ)
    f.moveTo(loopFrom + 10)
    f.moveTo(5 * SQ)
    f.write(0.5)
    f.moveTo(5 * SQ + 100)
    const regions = f.regions()
    expect(regions).toHaveLength(1)
    expect(regions[0].position.getValue()).toBe(5 * SQ)
    expect(regions[0].duration.getValue()).toBe(SQ)
    expect(clips.every(([, to]) => to <= 6 * SQ)).toBe(true)
    f.recording.terminate()
})

it("keeps growing past the loop end when takes are disabled and the engine does not loop", () => {
    const loopFrom = 0, loopTo = 8 * SQ
    const f = setup({loopFrom, loopTo, allowTakes: false, position: 4 * SQ})
    f.write(0.5)
    f.moveTo(10 * SQ + 1)
    expect(f.regions()[0].duration.getValue()).toBe(7 * SQ)
    f.recording.terminate()
    expect(f.regions()).toHaveLength(1)
    expect(f.regions()[0].duration.getValue()).toBe(7 * SQ)
})
