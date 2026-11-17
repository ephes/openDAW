import {AnimationFrame} from "@opendaw/lib-dom"
import {ModularWires} from "@/ui/modular/ModularWires"
import {BoxAdapters, BoxAdaptersContext, ModularAdapter, ModuleConnectionAdapter, Modules, ProjectSkeleton} from "@opendaw/studio-adapters"
import {BoxEditing} from "@opendaw/lib-box"
import {AudioUnitBox, ModularDeviceBox, ModularAudioInputBox, ModularAudioOutputBox, ModularBox, ModuleConnectionBox} from "@opendaw/studio-boxes"
import {Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {ConnectorViewAdapter, ModularEnvironment} from "@/ui/modular/ModularEnvironment"
import type {Camera} from "@/ui/modular/Camera"
import type {StudioService} from "@/service/StudioService"

export const modularProbe = () => {
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
    const connectors = [Modules.adapterFor(adapters, source).outputs[0], ...targets.map(box => Modules.adapterFor(adapters, box).inputs[0])]
    const views = connectors.map(adapter => {
        const element = document.createElement("div"); document.body.append(element)
        const view = new ConnectorViewAdapter(adapter, element, () => ({x: 0, y: 0}))
        environment.registerConnectorView(view)
        return view
    })
    const edge = () => editing.modify(() => ModuleConnectionBox.create(graph, UUID.generate(), box => {
        box.collection.refer(modular.connections); box.source.refer(source.output); box.target.refer(targets[0].input)
    })).unwrap()
    editing.clear()
    const camera = {globalToLocal: (x: number, y: number) => ({x, y}), localToGlobal: (x: number, y: number) => ({x, y})} as Camera
    const pending: Array<() => void> = []
    const once = AnimationFrame.once
    Object.defineProperty(AnimationFrame, "once", {configurable: true, writable: true, value: (callback: () => void) => {pending.push(callback)}})
    const flush = () => pending.splice(0).forEach(callback => callback())
    const one = new Terminator(), two = new Terminator()
    const module = Modules.adapterFor(adapters, targets[0])
    let activeSubscriptions = 0
    const track = <T>(field: {subscribe(observer: (value: T) => void): Terminable}) => {
        const subscribe = field.subscribe.bind(field)
        field.subscribe = observer => {
            activeSubscriptions++
            const owner = subscribe(observer)
            return {terminate: () => {activeSubscriptions--; owner.terminate()}}
        }
    }
    track(module.attributes.x); track(module.attributes.y); track(module.attributes.collapsed)
    const svg1 = ModularWires({lifecycle: one, environment, camera}) as SVGSVGElement
    const svg2 = ModularWires({lifecycle: two, environment, camera}) as SVGSVGElement
    document.body.append(svg1, svg2)
    const drop = (index: number) => views[index].element.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerId: 1}))
    try {
        const box = edge()
        editing.clear()
        const before = Array.from(new Uint8Array(graph.toArrayBuffer()))
        environment.beginRewiring(adapters.adapterFor(box, ModuleConnectionAdapter), connectors[1], {x: 0, y: 0})
        window.dispatchEvent(new PointerEvent("pointercancel", {pointerId: 1}))
        const cancelled = {before, after: Array.from(new Uint8Array(graph.toArrayBuffer())), wiring: environment.isWiring}
        environment.beginRewiring(adapters.adapterFor(box, ModuleConnectionAdapter), connectors[1], {x: 0, y: 0})
        drop(2)
        const undo = editing.undo(), redo = editing.redo()
        const stale = edge()
        editing.modify(() => stale.delete())
        flush()
        one.terminate()
        const remaining = activeSubscriptions
        environment.beginWiring(connectors[0], {x: 0, y: 0})
        const livePreview = svg2.querySelectorAll("line").length
        window.dispatchEvent(new Event("blur"))
        const afterBlur = svg2.querySelectorAll("line").length
        const current = environment.modularAdapter.connections[0]
        editing.modify(() => targets[1].delete())
        flush()
        two.terminate()
        flush()
        return {cancelled, undo, redo, remaining, retired: activeSubscriptions,
            livePreview, afterBlur, removed: graph.findBox(current.uuid).isEmpty()}
    } finally {
        one.terminate(); two.terminate(); environment.terminate()
        Object.defineProperty(AnimationFrame, "once", {configurable: true, writable: true, value: once})
    }
}
