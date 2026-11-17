import {AnimationFrame} from "@opendaw/lib-dom"
import {BoxEditing} from "@opendaw/lib-box"
import {DefaultObservableValue, Option, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, DelayDeviceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {CanvasPainter, ContextMenu, MenuItem} from "@opendaw/studio-core"
import {Menu} from "@/ui/components/Menu"
import {NumberInput} from "@/ui/components/NumberInput"
import {DevicePanel} from "@/ui/devices/panel/DevicePanel"
import {Surface} from "@/ui/surface/Surface"
import type {StudioService} from "@/service/StudioService"

// Standalone component fixture: the app shell's window/flyout boundary is synthetic.
Surface.get = () => ({owner: window, flyout: document.body}) as unknown as Surface
AnimationFrame.start(window)

export const menu = () => {
    let actions = 0
    const button = document.createElement("button")
    button.id = "menu-source"; button.textContent = "Context menu"
    document.body.append(button)
    const leaf = () => MenuItem.default({label: "Delete"}).setTriggerProcedure(() => actions++)
    const lifecycle = new Terminator()
    lifecycle.ownAll(
        ContextMenu.subscribe(button, collector => collector.addItems(leaf(), MenuItem.default({label: "More"}).addMenuItem(leaf()))),
        ContextMenu.install(window, (root, {clientX, clientY}) => {
            const menu = lifecycle.own(Menu.create(root))
            menu.moveTo(clientX, clientY); menu.attach(document.body)
        })
    )
    return {actions: () => actions, close: () => {lifecycle.terminate(); button.remove()}}
}

export const canvas = () => {
    const canvas = document.createElement("canvas")
    canvas.id = "density-canvas"; canvas.style.width = "100px"; canvas.style.height = "50px"
    document.body.append(canvas)
    let draws = 0
    const painter = new CanvasPainter(canvas, p => {
        draws++; p.context.fillRect(0, 0, p.actualWidth, p.actualHeight)
    })
    return {state: () => ({draws, width: canvas.width, ratio: devicePixelRatio}),
        close: () => {painter.terminate(); canvas.remove()}}
}

export const panel = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(boxGraph)
    const {unit, first, second} = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const effect = (index: number) => DelayDeviceBox.create(boxGraph, UUID.generate(), box => {
            box.host.refer(unit.audioEffects); box.index.setValue(index)
        })
        return {unit, first: effect(0), second: effect(1)}
    }).unwrap()
    const effects = [first, second].map(box => ({type: "audio-effect", box, indexField: box.index}))
    const host = {audioEffects: {adapters: () => effects}, midiEffects: {adapters: () => []}}
    const project = {editing, rootBox: mandatoryBoxes.rootBox, boxAdapters: {adapterFor: () => host},
        userEditingManager: {audioUnit: {get: () => Option.wrap({box: unit})}},
        deviceSelection: {isEmpty: () => false, selected: () => [effects[0]], deselectAll() {}}}
    // Isolate the raw panel key boundary from the full studio's deferred chain rendering.
    // Unit component tests separately exercise chain mounting and profile replacement.
    let dispatchingKey = false
    const service = {project, projectProfileService: {
        getValue: () => dispatchingKey ? Option.wrap({project}) : Option.None,
        catchupAndSubscribe: (observer: (value: Option<unknown>) => void) => {observer(Option.None); return Terminable.Empty}
    }} as unknown as StudioService
    const lifecycle = new Terminator()
    const element = DevicePanel({lifecycle, service}) as HTMLElement
    element.id = "device-panel"
    element.addEventListener("keydown", () => {dispatchingKey = true}, {capture: true})
    element.addEventListener("keydown", () => {dispatchingKey = false})
    const header = document.createElement("header"); header.id = "effect-header"; header.tabIndex = 0; header.textContent = "Selected synthetic effect"
    const number = NumberInput({lifecycle, model: new DefaultObservableValue(123)}) as HTMLElement
    number.id = "effect-number"
    element.append(header, number); document.body.append(element)
    editing.clear()
    return {state: () => ({present: boxGraph.findBox(first.address.uuid).nonEmpty(), index: second.index.getValue(), undo: editing.canUndo()}),
        undo: () => editing.undo(), close: () => {lifecycle.terminate(); element.remove()}}
}
