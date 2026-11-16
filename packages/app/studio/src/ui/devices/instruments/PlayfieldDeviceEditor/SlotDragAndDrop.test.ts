import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Option, Terminator, UUID} from "@opendaw/lib-std"
import {AudioFileBox, AudioUnitBox, PlayfieldDeviceBox, PlayfieldSampleBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"
import {DragAndDrop} from "@/ui/DragAndDrop"
import {SlotDragAndDrop} from "./SlotDragAndDrop"

const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(boxGraph)
    const {a, b, source, target, foreign} = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const a = PlayfieldDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(unit.input))
        const other = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const b = PlayfieldDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(other.input))
        const file = AudioFileBox.create(boxGraph, UUID.generate())
        const pad = (device: PlayfieldDeviceBox, index: number) => PlayfieldSampleBox.create(boxGraph, UUID.generate(), box => {
            box.device.refer(device.samples); box.file.refer(file); box.index.setValue(index)
        })
        const foreign = pad(a, 60), source = pad(b, 60), target = pad(b, 61)
        source.pitch.setValue(7); source.sampleStart.setValue(0.25); source.sampleEnd.setValue(0.75)
        source.attack.setValue(0.1); source.release.setValue(0.5); source.gate.setValue(2); source.polyphone.setValue(true)
        return {a, b, source, target, foreign}
    }).unwrap()
    editing.clear()
    const install = vi.spyOn(DragAndDrop, "installTarget").mockReturnValue(new Terminator())
    // The target's owning device is part of the drop authority.
    SlotDragAndDrop.installTarget({element: document.createElement("div"), project: {boxGraph, editing} as unknown as Project,
        device: b, getSlotIndex: () => 61} as Parameters<typeof SlotDragAndDrop.installTarget>[0])
    const handler = install.mock.calls.at(-1)![1]
    const drop = (altKey = false, box = source) => handler.drop({altKey} as DragEvent,
        {type: "playfield-slot", index: box.index.getValue(), uuid: UUID.toString(box.address.uuid)})
    return {a, b, source, target, foreign, editing, boxGraph, drop}
}
afterEach(() => vi.restoreAllMocks())
it("binds both swap directions to the dragged UUID and target device", () => {
    const f = fixture(); f.drop()
    expect(f.source.index.getValue()).toBe(61); expect(f.target.index.getValue()).toBe(60)
    expect(f.foreign.index.getValue()).toBe(60)
    f.drop(false, f.target)
    expect(f.source.index.getValue()).toBe(60); expect(f.target.index.getValue()).toBe(61)
    const before = new Uint8Array(f.boxGraph.toArrayBuffer()); f.drop(false, f.foreign)
    expect(new Uint8Array(f.boxGraph.toArrayBuffer())).toEqual(before)
})
it("copies every authored pad field with a new identity and shared file, and undoes replacement", () => {
    const f = fixture(); f.drop(true)
    const copy = f.b.samples.pointerHub.incoming().map(({box}) => box as PlayfieldSampleBox).find(box => box.index.getValue() === 61)!
    expect(copy).not.toBe(f.source)
    expect(copy.file.targetAddress).toEqual(f.source.file.targetAddress)
    for (const key of ["pitch", "sampleStart", "sampleEnd", "attack", "release", "gate", "polyphone"] as const) {
        expect(copy[key].getValue()).toBe(f.source[key].getValue())
    }
    expect(f.foreign.index.getValue()).toBe(60)
    expect(f.editing.undo()).toBe(true)
    expect(f.boxGraph.findBox(f.target.address.uuid).nonEmpty()).toBe(true)
    expect(f.editing.redo()).toBe(true)
})
it("preflights a detached file without deleting the target or adding history", () => {
    const f = fixture()
    vi.spyOn(f.source.file, "targetVertex", "get").mockReturnValue(Option.None)
    const modify = vi.spyOn(f.editing, "modify")
    const before = new Uint8Array(f.boxGraph.toArrayBuffer())
    f.drop(true)
    expect(modify).not.toHaveBeenCalled()
    expect(new Uint8Array(f.boxGraph.toArrayBuffer())).toEqual(before)
    expect(f.editing.canUndo()).toBe(false)
    expect(f.editing.undo()).toBe(false); expect(f.editing.redo()).toBe(false)
})
it("emits the canonical UUID from the actual drag source", () => {
    const f = fixture()
    const install = vi.spyOn(DragAndDrop, "installSource").mockReturnValue(new Terminator())
    SlotDragAndDrop.installSource({element: document.createElement("div"),
        sample: {address: f.source.address} as Parameters<typeof SlotDragAndDrop.installSource>[0]["sample"],
        getSlotIndex: () => f.source.index.getValue()})
    expect(install.mock.calls[0][1]()).toMatchObject({uuid: UUID.toString(f.source.address.uuid), index: 60})
})
