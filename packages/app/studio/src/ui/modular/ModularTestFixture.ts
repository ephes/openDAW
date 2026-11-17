import {vi} from "vitest"
import {BoxAdapters, BoxAdaptersContext, ModularAdapter, Modules, ProjectSkeleton} from "@opendaw/studio-adapters"
import {BoxEditing} from "@opendaw/lib-box"
import {AudioUnitBox, ModularDeviceBox, ModularAudioInputBox, ModularAudioOutputBox, ModularBox, ModuleConnectionBox} from "@opendaw/studio-boxes"
import {Terminable, UUID} from "@opendaw/lib-std"
import {ConnectorViewAdapter, ModularEnvironment} from "./ModularEnvironment"
import type {Camera} from "./Camera"
import type {StudioService} from "@/service/StudioService"

export const owners: ModularEnvironment[] = []
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
