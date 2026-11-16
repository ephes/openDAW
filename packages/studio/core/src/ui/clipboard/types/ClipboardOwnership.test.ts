import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Option, UUID} from "@opendaw/lib-std"
import {CompressorDeviceBox, TrackBox} from "@opendaw/studio-boxes"
import {Pointers} from "@opendaw/studio-enums"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {DevicesClipboard} from "./DevicesClipboardHandler"
import {AudioUnitsClipboard} from "./AudioUnitsClipboardHandler"
import {ClipboardUtils} from "../ClipboardUtils"

afterEach(() => vi.restoreAllMocks())
const setup = () => {
    const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioUnitBox: outputBox, primaryAudioBusBox}} = skeleton
    const output = outputBox
    const editing = new BoxEditing(boxGraph)
    boxGraph.beginTransaction()
    const effect = CompressorDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(output.audioEffects))
    const protectedEffect = CompressorDeviceBox.create(boxGraph, UUID.generate(), box => {
        box.host.refer(output.audioEffects); box.index.setValue(1)
    })
    const track = TrackBox.create(boxGraph, UUID.generate(), box => {box.tracks.refer(output.tracks); box.target.refer(effect.threshold)})
    boxGraph.endTransaction()
    const effects = [effect, protectedEffect].map(box => ({box, type: "audio-effect", indexField: box.index}))
    Object.defineProperty(protectedEffect, "tags", {value: {...protectedEffect.tags, copyable: false}})
    const host = {
        box: output, type: output.type.getValue(), isOutput: true,
        input: {adapter: () => Option.None}, midiEffects: {adapters: () => []},
        audioEffects: {adapters: () => boxGraph.boxes().filter(box => box instanceof CompressorDeviceBox).map(box => effects.find(a => a.box === box) ?? ({box, indexField: box.index}))},
        tracks: {collection: {adapters: () => boxGraph.boxes().filter(box => box instanceof TrackBox).map(box => ({box}))}}
    }
    const root = {box: rootBox, audioUnits: {adapters: () => [host]}, audioBusses: {adapters: () => [{address: primaryAudioBusBox.address}]}}
    const audioContext = {getEnabled: () => true, editing, boxGraph, rootBoxAdapter: root,
        audioUnitEditing: {}, getEditedAudioUnit: () => Option.wrap(host)} as unknown as AudioUnitsClipboard.Context
    return {boxGraph, editing, effect, protectedEffect, track, effects, host, audioContext}
}

it("cuts only the serialized effects and preserves protected effects through undo/redo", () => {
    const {boxGraph, editing, effect, protectedEffect, effects, host} = setup()
    const context = {getEnabled: () => true, editing, boxGraph, selection: {selected: () => effects},
        boxAdapters: {}, getHost: () => Option.wrap(host)} as unknown as DevicesClipboard.Context
    const handler = DevicesClipboard.createHandler(context)
    expect(handler.canCut({clientX: 0, clientY: 0})).toBe(true)
    const entry = handler.cut().unwrap()
    expect(effect.isAttached()).toBe(false)
    expect(protectedEffect.isAttached()).toBe(true)
    expect(protectedEffect.index.getValue()).toBe(0)
    const target = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const pasted = target.boxGraph
    pasted.beginTransaction()
    expect(ClipboardUtils.deserializeBoxes(entry.data, pasted, {mapPointer: pointer => pointer.pointerType === Pointers.AudioEffectHost
            ? Option.wrap(target.mandatoryBoxes.primaryAudioUnitBox.audioEffects.address)
            : pointer.pointerType === Pointers.TrackCollection
                ? Option.wrap(target.mandatoryBoxes.primaryAudioUnitBox.tracks.address) : Option.None})
        .filter(box => box instanceof CompressorDeviceBox)).toHaveLength(1)
    pasted.endTransaction()
    editing.undo()
    expect(boxGraph.findBox(effect.address.uuid).nonEmpty()).toBe(true)
    expect(boxGraph.findBox(protectedEffect.address.uuid).nonEmpty()).toBe(true)
    editing.redo()
    expect(boxGraph.findBox(effect.address.uuid).isEmpty()).toBe(true)
    expect(boxGraph.findBox(protectedEffect.address.uuid).nonEmpty()).toBe(true)
})

it("does not offer cut for instruments alone", () => {
    const {audioContext, host} = setup()
    const context = {...audioContext, selection: {selected: () => [{type: "instrument", box: {tags: {}}}]},
        boxAdapters: {}, getHost: () => Option.wrap(host)} as unknown as DevicesClipboard.Context
    expect(DevicesClipboard.createHandler(context).canCut({clientX: 0, clientY: 0})).toBe(false)
})

it("compensates both output paste phases without changing undo history on install failure", () => {
    const {boxGraph, editing, effect, audioContext} = setup()
    const handler = AudioUnitsClipboard.createHandler(audioContext)
    const entry = handler.copy().unwrap()
    editing.modify(() => effect.threshold.setValue(-12))
    editing.undo() // Preserve an existing redo step as well.
    const snapshot = () => boxGraph.boxes().map(box => [UUID.toString(box.address.uuid), box.toJSON()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    const before = snapshot()
    const create = boxGraph.createBox.bind(boxGraph)
    let calls = 0
    vi.spyOn(boxGraph, "createBox").mockImplementation((...args) => {
        if (++calls === 2) {throw new Error("synthetic install failure")}
        return create(...args)
    })
    expect(() => handler.paste(entry)).toThrow("synthetic install failure")
    expect(snapshot()).toEqual(before)
    expect(editing.canUndo()).toBe(false)
    expect(editing.canRedo()).toBe(true)
    vi.restoreAllMocks()
    handler.paste(entry)
    expect(editing.undo()).toBe(true)
    expect(snapshot()).toEqual(before)
    expect(editing.redo()).toBe(true)
})

it("validates the complete output payload before deleting master content", () => {
    const {editing, effect, audioContext} = setup()
    const handler = AudioUnitsClipboard.createHandler(audioContext)
    const entry = handler.copy().unwrap()
    const deletion = vi.spyOn(effect, "delete")
    expect(() => handler.paste({...entry, data: entry.data.slice(0, entry.data.byteLength - 1)})).toThrow()
    expect(deletion).not.toHaveBeenCalled()
    expect(editing.canUndo()).toBe(false)
})
