import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, DelayDeviceBox, PitchDeviceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"
import {DragAndDrop} from "@/ui/DragAndDrop"
import {DevicePanelDragAndDrop} from "./DevicePanelDragAndDrop"
vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("@/ui/components/InsertMarker", () => ({InsertMarker: () => document.createElement("div")}))
vi.mock("@/ui/browse/PresetApplication", () => ({PresetApplication: {}}))
afterEach(() => vi.restoreAllMocks())
it("refuses foreign, mixed-kind, missing and duplicate effect selections atomically", () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(boxGraph)
    const f = editing.modify(() => {
        const unit = () => AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const a = unit(), b = unit()
        const effect = (host: AudioUnitBox, index: number) => DelayDeviceBox.create(boxGraph, UUID.generate(), box => {
            box.host.refer(host.audioEffects); box.index.setValue(index)
        })
        return {a, b, foreign: effect(a, 0), first: effect(b, 0), second: effect(b, 1),
            midi: PitchDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(b.midiEffects))}
    }).unwrap()
    const host = {audioEffects: {field: () => f.b.audioEffects}, midiEffects: {field: () => f.b.midiEffects}}
    const project = {boxGraph, editing, boxAdapters: {adapterFor: () => host},
        userEditingManager: {audioUnit: {get: () => Option.wrap({box: f.b})}}} as unknown as Project
    const install = vi.spyOn(DragAndDrop, "installTarget").mockReturnValue(Terminable.Empty)
    vi.spyOn(DragAndDrop, "findInsertLocation").mockReturnValue([2, null])
    const elements = Array.from({length: 4}, () => document.createElement("div"))
    DevicePanelDragAndDrop.install(project, elements[0], elements[1], elements[2], elements[3])
    const drop = (uuids: UUID.String[]) => install.mock.calls[0][1].drop({} as DragEvent,
        {type: "audio-effect", instrument: null, uuids})
    editing.clear()
    for (const selection of [[f.foreign], [f.first, f.midi], [f.first, f.first]]) {
        const before = boxGraph.toArrayBuffer(); drop(selection.map(box => UUID.toString(box.address.uuid)))
        expect(boxGraph.toArrayBuffer()).toEqual(before); expect(editing.canUndo()).toBe(false)
    }
    drop([UUID.toString(f.first.address.uuid), UUID.toString(UUID.generate())])
    expect(editing.canUndo()).toBe(false)
    drop([UUID.toString(f.first.address.uuid)])
    expect(f.first.index.getValue()).toBe(1); expect(f.second.index.getValue()).toBe(0)
    expect(f.foreign.index.getValue()).toBe(0)
})
