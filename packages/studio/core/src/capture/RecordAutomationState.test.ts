import {expect, it, vi} from "vitest"
import {Address, BoxEditing} from "@opendaw/lib-box"
import {DefaultObservableValue, Notifier, Option, UUID} from "@opendaw/lib-std"
import {ppqn} from "@opendaw/lib-dsp"
import {ParameterWriteEvent, ProjectSkeleton, TrackType} from "@opendaw/studio-adapters"
import {StereoToolDeviceBox, TrackBox, ValueEventBox, ValueEventCollectionBox, ValueRegionBox} from "@opendaw/studio-boxes"
import type {Project} from "../project"
import {RecordAutomation} from "./RecordAutomation"

vi.mock("../ui", () => ({RegionClipResolver: {fromRange: () => () => {}}}))

const eventsOf = (collectionBox: ValueEventCollectionBox) => collectionBox.events.pointerHub.incoming()
    .map(({box}) => box as ValueEventBox)
    .sort((a, b) => a.position.getValue() - b.position.getValue() || a.index.getValue() - b.index.getValue())

const setup = (floating: boolean) => {
    const {boxGraph, mandatoryBoxes: {primaryAudioUnitBox, timelineBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const device = editing.modify(() => StereoToolDeviceBox.create(boxGraph, UUID.generate(), box =>
        box.host.refer(primaryAudioUnitBox.audioEffects))).unwrap()
    const trackBox = editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(TrackType.Value)
        box.tracks.refer(primaryAudioUnitBox.tracks)
        box.target.refer(device.volume)
    })).unwrap()
    const trackBoxAdapter = {box: trackBox, regions: {collection: {asArray: () => []}}}
    let unitValue = 0.0
    const adapter = {
        address: device.volume.address, name: "Volume", field: device.volume,
        getUnitValue: () => unitValue, valueMapping: {floating: () => floating}
    }
    const writes = new Notifier<ParameterWriteEvent>()
    const touchEnds = new Notifier<Address>()
    const parameterFieldAdapters = {
        getTracks: () => Option.wrap({controls: () => Option.wrap(trackBoxAdapter)}),
        isTouched: () => true,
        subscribeWrites: (observer: (event: ParameterWriteEvent) => void) => writes.subscribe(observer),
        subscribeTouchEnd: (observer: (address: Address) => void) => touchEnds.subscribe(observer)
    }
    const boxAdapters = {
        adapterFor: (collectionBox: ValueEventCollectionBox) => {
            const events = eventsOf(collectionBox).map(box => ({
                box, position: box.position.getValue(), value: box.value.getValue(), interpolation: {type: "linear"}
            }))
            return {events: {asArray: () => events, remove: vi.fn()}}
        }
    }
    const engine = {
        position: new DefaultObservableValue<ppqn>(0),
        isRecording: new DefaultObservableValue(true),
        preferences: {settings: {recording: {allowTakes: true}}}
    }
    const project = {
        boxGraph, editing, engine, timelineBox, parameterFieldAdapters, boxAdapters,
        selection: {select: vi.fn(), deselect: vi.fn()}
    } as unknown as Project
    const recording = RecordAutomation.start(project)
    const write = (position: ppqn, value: number) => {
        engine.position.setValue(position)
        const previousUnitValue = unitValue
        unitValue = value
        writes.notify({adapter, previousUnitValue} as unknown as ParameterWriteEvent)
    }
    const touchEnd = () => touchEnds.notify(device.volume.address)
    const regions = () => trackBox.regions.pointerHub.incoming().map(({box}) => box as ValueRegionBox)
    const collection = (region: ValueRegionBox) =>
        region.events.targetVertex.unwrap().box as ValueEventCollectionBox
    return {editing, recording, write, touchEnd, regions, collection, engine}
}

it("retires an active recording whose region was deleted and records into a new region", () => {
    const f = setup(false)
    f.write(0, 0.25)
    f.write(100, 0.5)
    const [deleted] = f.regions()
    f.editing.modify(() => deleted.delete())
    expect(() => f.write(500, 0.75)).not.toThrow()
    f.engine.position.setValue(700)
    const regions = f.regions()
    expect(regions).toHaveLength(1)
    expect(regions[0].position.getValue()).toBe(480)
    expect(eventsOf(f.collection(regions[0])).map(event => event.value.getValue())).toContain(0.75)
    f.recording.terminate()
    expect(f.regions()).toHaveLength(1)
})

it("keeps every simplified sample within the error envelope", () => {
    const f = setup(true)
    const curve = (position: number) => Math.pow(position / 2000, 2)
    const samples: Array<[number, number]> = []
    for (let position = 0; position <= 2000; position += 10) {
        samples.push([position, curve(position)])
        f.write(position, curve(position))
    }
    f.touchEnd()
    const kept = eventsOf(f.collection(f.regions()[0]))
        .map(event => [event.position.getValue(), event.value.getValue()] as const)
    expect(kept.length).toBeLessThan(samples.length)
    const valueAt = (position: number) => {
        const index = kept.findIndex(([keptPosition]) => keptPosition >= position)
        if (kept[index][0] === position) {return kept[index][1]}
        const [p0, v0] = kept[index - 1], [p1, v1] = kept[index]
        return v0 + (position - p0) / (p1 - p0) * (v1 - v0)
    }
    const maxError = Math.max(...samples.map(([position, value]) => Math.abs(valueAt(position) - value)))
    expect(maxError).toBeLessThanOrEqual(0.01 + 1e-6)
})
