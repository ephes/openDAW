import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, DelayDeviceBox, VaporisateurDeviceBox} from "@opendaw/studio-boxes"
import {DeviceBoxAdapter, PresetEncoder, PresetHeader, ProjectSkeleton} from "@opendaw/studio-adapters"
import type {PresetEntry, Project} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"
import {PresetService} from "./PresetService"
import {PresetApplication} from "./PresetApplication"
import {PresetDialogs} from "./PresetDialogs"
import {PresetStorage} from "@opendaw/studio-core"

vi.mock("@opendaw/studio-core", () => ({
    PresetStorage: {save: vi.fn(), readIndex: async () => {}, observable: () => ({getValue: () => []})},
    OpenPresetAPI: {get: () => ({list: async () => []})}
}))
vi.mock("./PresetDialogs", () => ({PresetDialogs: {showSavePresetDialog: vi.fn()}}))
vi.mock("./PresetApplication", () => ({PresetApplication: {loadBytes: vi.fn()}}))
const entry = (name: string): Extract<PresetEntry, {category: "audio-effect"}> => ({source: "user", category: "audio-effect", device: "Delay",
    uuid: UUID.toString(UUID.generate()), name, description: "", created: 0, modified: 0})
const fixture = () => {
    const skeleton = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const graph = skeleton.boxGraph
    const editing = new BoxEditing(graph)
    const unit = editing.modify(() => AudioUnitBox.create(graph, UUID.generate(), box =>
        box.collection.refer(skeleton.mandatoryBoxes.rootBox.audioUnits))).unwrap()
    const makeEffect = (index: number) => editing.modify(() => DelayDeviceBox.create(graph, UUID.generate(), box => {
        box.host.refer(unit.audioEffects); box.index.setValue(index); box.label.setValue("Original")
    })).unwrap()
    const effect = makeEffect(0)
    const host = {audioUnitBoxAdapter: () => ({box: unit}), audioEffects: {field: () => unit.audioEffects}}
    const adapterFor = (box: DelayDeviceBox) => ({box, uuid: box.address.uuid, type: "audio-effect", accepts: "audio",
        indexField: box.index, labelField: box.label, deviceHost: () => host}) as unknown as DeviceBoxAdapter
    const graphState = () => graph.boxes().map(box => ({uuid: UUID.toString(box.address.uuid), name: box.name,
        fields: new Uint8Array(box.toArrayBuffer())})).sort((a, b) => a.uuid.localeCompare(b.uuid))
    const project = {boxGraph: graph, editing, boxAdapters: {adapterFor}, loadScriptDevices: vi.fn()} as unknown as Project
    let current: Project | undefined = project
    const service = {get project() {return current}, get optProject() {return Option.wrap(current)}} as StudioService
    const presets = new PresetService(service)
    const bytes = (label: string) => {
        editing.modify(() => effect.label.setValue(label))
        const data = PresetEncoder.encodeEffects([effect], PresetHeader.ChainKind.Audio)
        editing.modify(() => effect.label.setValue("Original")); editing.clear()
        return data as ArrayBuffer
    }
    return {graph, graphState, editing, unit, effect, project, presets, adapter: adapterFor(effect), makeEffect, adapterFor, bytes,
        switch: (next?: Project) => {current = next}}
}
beforeEach(() => {vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})

it.each(["corrupt", "wrong kind"])("preserves graph, parameters, history and cursor on %s refusal", async fault => {
    const f = fixture()
    const data = fault === "corrupt" ? new ArrayBuffer(0)
        : PresetEncoder.encodeEffects([f.effect], PresetHeader.ChainKind.Audio)
    f.editing.clear()
    const previous = entry("Previous")
    f.presets.setCursor(f.adapter, previous)
    const before = f.graphState()
    vi.mocked(PresetApplication.loadBytes).mockResolvedValue(data as ArrayBuffer)
    await f.presets.applyPresetTo(f.adapter, {...entry("Refused"), category: fault === "wrong kind" ? "midi-effect" : "audio-effect"} as PresetEntry)
    expect(f.graphState()).toEqual(before)
    expect(f.editing.canUndo()).toBe(false)
    expect(f.presets.cursorFor(f.adapter).unwrap()).toBe(`user:${previous.uuid}`)
    expect(f.project.loadScriptDevices).not.toHaveBeenCalled()
})
it("installs only the latest selection for a slot and records one undo step", async () => {
    const f = fixture(), a = entry("A"), b = entry("B")
    const dataA = f.bytes("A"), dataB = f.bytes("B")
    const gateA = Promise.withResolvers<ArrayBuffer>(), gateB = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(PresetApplication.loadBytes).mockReturnValueOnce(gateA.promise).mockReturnValueOnce(gateB.promise)
    const before = f.graphState()
    const runA = f.presets.applyPresetTo(f.adapter, a), runB = f.presets.applyPresetTo(f.adapter, b)
    gateB.resolve(dataB); await runB; gateA.resolve(dataA); await runA
    expect(f.unit.audioEffects.pointerHub.incoming().map(({box}) => (box as DelayDeviceBox).label.getValue())).toEqual(["B"])
    expect(f.presets.cursorFor(f.adapterFor(f.unit.audioEffects.pointerHub.incoming()[0].box as DelayDeviceBox)).unwrap()).toBe(`user:${b.uuid}`)
    expect(f.project.loadScriptDevices).toHaveBeenCalledTimes(1)
    expect(f.editing.undo()).toBe(true)
    expect(f.graphState()).toEqual(before)
    expect(f.editing.canUndo()).toBe(false)
})
it.each(["switch", "close", "delete"])("drops deferred completions after %s", async action => {
    const f = fixture(), gate = Promise.withResolvers<ArrayBuffer>(), data = f.bytes("Late")
    vi.mocked(PresetApplication.loadBytes).mockReturnValue(gate.promise)
    const run = f.presets.applyPresetTo(f.adapter, entry("Late"))
    if (action === "switch") {f.switch(fixture().project)}
    if (action === "close") {f.switch()}
    if (action === "delete") {f.editing.modify(() => f.effect.delete())}
    const before = f.graphState()
    gate.resolve(data); await run
    expect(f.graphState()).toEqual(before)
    expect(f.project.loadScriptDevices).not.toHaveBeenCalled()
    expect(f.presets.cursorFor(f.adapter).isEmpty()).toBe(true)
})
it("allows unrelated slots to finish independently", async () => {
    const f = fixture(), data = f.bytes("Preset"), second = f.makeEffect(1)
    const gate = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(PresetApplication.loadBytes).mockReturnValueOnce(gate.promise).mockResolvedValueOnce(data)
    const a = entry("A"), b = entry("B")
    const pending = f.presets.applyPresetTo(f.adapter, a)
    await f.presets.applyPresetTo(f.adapterFor(second), b)
    gate.resolve(data); await pending
    expect(f.unit.audioEffects.pointerHub.incoming()).toHaveLength(2)
    expect(f.project.loadScriptDevices).toHaveBeenCalledTimes(2)
})

it.each(["delete", "edit", "switch"])("refuses changed single-effect save source after %s during dialog", async action => {
    const f = fixture()
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof PresetDialogs.showSavePresetDialog>>>()
    vi.mocked(PresetDialogs.showSavePresetDialog).mockReturnValue(gate.promise)
    const run = f.presets.saveAsSingleEffectPreset("audio-effect", "Delay", f.effect)
    if (action === "delete") {f.editing.modify(() => f.effect.delete())}
    if (action === "edit") {f.editing.modify(() => f.effect.label.setValue("Changed"))}
    if (action === "switch") {f.switch(fixture().project)}
    gate.resolve({name: "Saved", description: "", includeTimeline: false}); await run
    expect(PresetStorage.save).not.toHaveBeenCalled()
    expect(RuntimeNotifier.info).toHaveBeenCalledWith(expect.objectContaining({headline: "Preset Source Changed"}))
})
it("refuses replacing an existing preset after a source edit", async () => {
    const f = fixture(), gate = Promise.withResolvers<boolean>()
    vi.spyOn(RuntimeNotifier, "approve").mockReturnValue(gate.promise)
    // Drag admission is unrelated to the asynchronous source ownership under test.
    vi.spyOn(f.presets, "canReplacePreset").mockReturnValue(true)
    vi.spyOn(f.presets, "resolveEffectBoxesFromDrag").mockReturnValue([f.effect])
    const run = f.presets.replacePreset(entry("Existing"), {type: "audio-effect", instrument: null, uuids: [UUID.toString(f.effect.address.uuid)]})
    f.editing.modify(() => f.effect.label.setValue("Changed"))
    gate.resolve(true); await run
    expect(PresetStorage.save).not.toHaveBeenCalled()
})
it("saves a stable source after dialog confirmation", async () => {
    const f = fixture()
    vi.mocked(PresetDialogs.showSavePresetDialog).mockResolvedValue({name: "Saved", description: "", includeTimeline: false})
    await f.presets.saveAsSingleEffectPreset("audio-effect", "Delay", f.effect)
    expect(PresetStorage.save).toHaveBeenCalledOnce()
})

it.each(["instrument", "rack"])("refuses %s saves when the rack changes during confirmation", async kind => {
    const f = fixture()
    const source = f.editing.modify(() => VaporisateurDeviceBox.create(f.graph, UUID.generate(), box => box.host.refer(f.unit.input))).unwrap()
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof PresetDialogs.showSavePresetDialog>>>()
    vi.mocked(PresetDialogs.showSavePresetDialog).mockReturnValue(gate.promise)
    const uuid = UUID.toString(source.address.uuid)
    const pending = kind === "rack" ? f.presets.saveAsRackPreset(uuid, []) : f.presets.saveAsInstrumentPreset("Vaporisateur", uuid)
    f.makeEffect(1)
    gate.resolve({name: "Saved", description: "", includeTimeline: true}); await pending
    expect(PresetStorage.save).not.toHaveBeenCalled()
    expect(RuntimeNotifier.info).toHaveBeenCalledWith(expect.objectContaining({headline: "Preset Source Changed"}))
})

it("rolls back a partially installed preset without adding an undo step", async () => {
    const f = fixture(), data = f.bytes("Incoming"), before = f.graphState()
    const create = f.graph.createBox.bind(f.graph)
    vi.spyOn(f.graph, "createBox").mockImplementation((...args) => {
        create(...args); throw new Error("synthetic installation failure")
    })
    vi.mocked(PresetApplication.loadBytes).mockResolvedValue(data)
    await f.presets.applyPresetTo(f.adapter, entry("Refused"))
    expect(f.graphState()).toEqual(before)
    expect(f.editing.canUndo()).toBe(false)
    expect(f.presets.cursorFor(f.adapter).isEmpty()).toBe(true)
})
