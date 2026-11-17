import {expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Lifecycle, Terminator, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, MIDIOutputDeviceBox, MIDIOutputParameterBox, TrackBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton, TrackType} from "@opendaw/studio-adapters"
import type {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"
import {ControlValues} from "./ControlValues"
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix}}
})
const calls = vi.hoisted(() => ({live: 0, edits: 0, released: 0}))
vi.mock("@/ui/devices/instruments/MIDIOutputEditor/ControlValue", () => ({ControlValue: ({lifecycle, box}: {lifecycle: Lifecycle, box: MIDIOutputParameterBox}) => {
    calls.live++
    lifecycle.own(box.label.subscribe(() => calls.edits++))
    lifecycle.own({terminate: () => {calls.live--; calls.released++}})
    return document.createElement("div")
}}))
it("retires remaining CC rows on parent teardown, independently of parameter removal", () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(boxGraph)
    const {device, rows} = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const device = MIDIOutputDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(unit.input))
        const rows = Array.from({length: 3}, () => MIDIOutputParameterBox.create(boxGraph, UUID.generate(), box => box.owner.refer(device.parameters)))
        rows.forEach((row, index) => TrackBox.create(boxGraph, UUID.generate(), box => {
            box.target.refer(row.value); box.tracks.refer(unit.tracks); box.type.setValue(TrackType.Value); box.index.setValue(index)
        }))
        return {device, rows}
    }).unwrap()
    const adapter = {box: device, parameters: {parameterAt: () => ({})},
        deviceHost: () => ({audioUnitBoxAdapter: () => ({tracks: {}})})} as unknown as MIDIOutputDeviceBoxAdapter
    const mount = () => {
        const lifecycle = new Terminator()
        const element = ControlValues({lifecycle, project: {} as Project, adapter}) as HTMLElement
        return {lifecycle, element}
    }
    const first = mount(); expect(calls.live).toBe(3)
    editing.modify(() => rows[0].delete()); expect(calls.live).toBe(2)
    first.lifecycle.terminate(); first.lifecycle.terminate()
    expect(calls.live).toBe(0); expect(calls.released).toBe(3)
    editing.modify(() => rows[1].label.setValue("Retired")); expect(calls.edits).toBe(0)
    const second = mount(); expect(calls.live).toBe(2)
    editing.modify(() => rows[1].label.setValue("Visible")); expect(calls.edits).toBe(1)
    second.lifecycle.terminate(); expect(calls.live).toBe(0)
    expect(device.parameters.pointerHub.size()).toBe(2)
})
