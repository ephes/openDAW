import {afterEach, expect, it, vi} from "vitest"
import {BoxAdapters, BoxAdaptersContext, ModularAdapter, ModuleConnectionAdapter, Modules, ProjectSkeleton} from "@opendaw/studio-adapters"
import {BoxEditing} from "@opendaw/lib-box"
import {AudioUnitBox, ModularDeviceBox, ModularAudioInputBox, ModularAudioOutputBox, ModularBox, ModuleConnectionBox} from "@opendaw/studio-boxes"
import {Terminable, UUID} from "@opendaw/lib-std"
import {ConnectorViewAdapter, ModularEnvironment} from "./ModularEnvironment"
import type {Camera} from "./Camera"
import type {StudioService} from "@/service/StudioService"

vi.mock("@/ui/surface/Surface.tsx", () => ({Surface: {get: () => ({owner: window})}}))
const owners: ModularEnvironment[] = []
afterEach(() => {owners.splice(0).forEach(owner => owner.terminate()); vi.restoreAllMocks(); document.body.replaceChildren()})
export const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    const context = {boxGraph: graph} as BoxAdaptersContext
    const adapters = new BoxAdapters(context)
    Object.assign(context, {boxAdapters: adapters})
    const modular = editing.modify(() => {
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const modular = ModularBox.create(graph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.modularSetups))
        ModularDeviceBox.create(graph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.modularSetup.refer(modular.device)})
        return modular
    }).unwrap()
    const source = editing.modify(() => ModularAudioInputBox.create(graph, UUID.generate(), box => box.attributes.collection.refer(modular.modules))).unwrap()
    const targets = [0, 1].map(() => editing.modify(() => ModularAudioOutputBox.create(graph, UUID.generate(), box => box.attributes.collection.refer(modular.modules))).unwrap())
    const service = {project: {boxGraph: graph, editing, selection: {createFilteredSelection: () => ({terminate() {}, catchupAndSubscribe: () => Terminable.Empty})}}} as unknown as StudioService
    const environment = new ModularEnvironment(service, adapters.adapterFor(modular, ModularAdapter), {} as Camera)
    owners.push(environment)
    const connectors = [Modules.adapterFor(adapters, source).outputs[0], ...targets.map(box => Modules.adapterFor(adapters, box).inputs[0])]
    const views = connectors.map(adapter => {
        const element = document.createElement("div"); document.body.append(element)
        const view = new ConnectorViewAdapter(adapter, element, () => ({x: 0, y: 0}))
        environment.registerConnectorView(view)
        return view
    })
    const previews: Array<{terminate: ReturnType<typeof vi.fn>}> = []
    environment.setWiringPreview({begin: () => {const preview = {terminate: vi.fn(), update: vi.fn()}; previews.push(preview); return preview}, highlight: () => Terminable.Empty})
    const edge = () => editing.modify(() => ModuleConnectionBox.create(graph, UUID.generate(), box => {
        box.collection.refer(modular.connections); box.source.refer(source.output); box.target.refer(targets[0].input)
    })).unwrap()
    editing.clear()
    return {graph, editing, environment, connectors, views, previews, edge, targets, adapters, modular}
}
const point = {x: 0, y: 0}
const drop = (element: Element) => element.dispatchEvent(new Event("pointerup", {bubbles: true}))
it("does not enter wiring when no destinations match", () => {
    const f = fixture()
    vi.spyOn(f.environment, "findMatchingConnectorViews").mockReturnValue([])
    f.environment.beginWiring(f.connectors[0], point)
    expect(f.environment.isWiring).toBe(false)
    expect(f.previews).toHaveLength(0)
})
it.each(["pointercancel", "blur", "terminate"])("retires on %s and ignores late drops", kind => {
    const f = fixture()
    f.environment.beginWiring(f.connectors[0], point)
    if (kind === "terminate") {f.environment.terminate()} else {window.dispatchEvent(new Event(kind))}
    drop(f.views[1].element)
    expect(f.environment.isWiring).toBe(false)
    expect(f.previews[0].terminate).toHaveBeenCalledOnce()
    expect(document.querySelectorAll(".accepting")).toHaveLength(0)
    expect(f.modular.connections.pointerHub.incoming()).toHaveLength(0)
})
it("supersedes the previous preview and always finalizes throwing commits", () => {
    const f = fixture()
    f.environment.beginWiring(f.connectors[0], point)
    f.environment.beginWiring(f.connectors[0], point)
    expect(f.previews[0].terminate).toHaveBeenCalledOnce()
    const onError = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener("error", onError)
    vi.spyOn(ModuleConnectionBox, "create").mockImplementationOnce(() => {throw new Error("injected")})
    drop(f.views[1].element)
    window.removeEventListener("error", onError)
    expect(f.environment.isWiring).toBe(false)
    expect(f.previews[1].terminate).toHaveBeenCalledOnce()
    f.environment.beginWiring(f.connectors[0], point); drop(f.views[1].element)
    expect(f.modular.connections.pointerHub.incoming()).toHaveLength(1)
})
it.each(["cancel", "incompatible", "setup"])("preserves the original rewire on %s", kind => {
    const f = fixture(), box = f.edge()
    const before = new Uint8Array(f.graph.toArrayBuffer())
    if (kind === "setup") {vi.spyOn(f.environment, "findMatchingConnectorViews").mockReturnValue([])}
    f.environment.beginRewiring(f.adapters.adapterFor(box, ModuleConnectionAdapter), f.connectors[1], point)
    if (kind === "incompatible") {drop(f.views[0].element)} else {window.dispatchEvent(new Event("pointercancel"))}
    expect(new Uint8Array(f.graph.toArrayBuffer())).toEqual(before)
})
it("replaces a route in one undo step and rejects a deleted endpoint", () => {
    const f = fixture(), box = f.edge()
    f.editing.clear()
    const originalId = box.address.uuid
    f.environment.beginRewiring(f.adapters.adapterFor(box, ModuleConnectionAdapter), f.connectors[1], point)
    drop(f.views[2].element)
    expect(f.graph.findBox(box.address.uuid).isEmpty()).toBe(true)
    expect(f.editing.undo()).toBe(true)
    const restored = f.graph.findBox<ModuleConnectionBox>(originalId).unwrap()
    expect(restored.source.targetVertex.unwrap().address.equals(f.connectors[0].address)).toBe(true)
    expect(restored.target.targetVertex.unwrap().address.equals(f.connectors[1].address)).toBe(true)
    expect(f.modular.connections.pointerHub.incoming()).toHaveLength(1)
    expect(f.editing.canUndo()).toBe(false)
    expect(f.editing.redo()).toBe(true)
    f.environment.beginWiring(f.connectors[0], point)
    f.editing.modify(() => f.targets[0].delete())
    const deleted = new Uint8Array(f.graph.toArrayBuffer())
    drop(f.views[1].element)
    expect(new Uint8Array(f.graph.toArrayBuffer())).toEqual(deleted)
})
