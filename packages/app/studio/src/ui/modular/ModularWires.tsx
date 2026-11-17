import css from "./ModularWires.sass?inline"
import {
    assert,
    Lifecycle,
    Point,
    SortedSet,
    Subscription,
    Terminable,
    Terminator,
    UUID,
    VitalSigns
} from "@opendaw/lib-std"
import {appendChildren, createElement} from "@opendaw/lib-jsx"
import {ConnectorViewAdapter, ModularEnvironment, WiringPreview} from "@/ui/modular/ModularEnvironment.ts"
import {ModuleAdapter, ModuleConnectionAdapter, ModuleConnectorAdapter} from "@opendaw/studio-adapters"
import {Camera} from "@/ui/modular/Camera.ts"
import {DeferExec, deferNextFrame, Html} from "@opendaw/lib-dom"
import {Colors, Pointers} from "@opendaw/studio-enums"

const className = Html.adoptStyleSheet(css, "ModularWires")

type Construct = {
    lifecycle: Lifecycle
    environment: ModularEnvironment
    camera: Camera
}

type ConnectionView = {
    adapter: ModuleConnectionAdapter
    wire: SVGPathElement
    pending: DeferExec
}

export const ModularWires = ({lifecycle, environment, camera}: Construct) => {
    const vitalSigns = lifecycle.own(new VitalSigns())
    const wires: SVGGraphicsElement = <g classList="wires"/>
    const svg: SVGSVGElement = <svg classList={className} viewBox="0 0 1 1">{wires}</svg>
    const connections: SortedSet<UUID.Bytes, ConnectionView> = UUID.newSet(view => view.adapter.uuid)
    const updateWirePath = (path: SVGPathElement, {x: x1, y: y1}: Point, {x: x2, y: y2}: Point): void => {
        const dx = x2 - x1
        const dy = y2 - y1
        const dd = Math.sqrt(dx * dx + dy * dy)
        const minOutreach = Math.min(64, dd)
        const c1 = x1 + Math.max(minOutreach, dx * 0.5)
        const c2 = x2 - Math.max(minOutreach, dx * 0.5)
        path.setAttribute("d", `M${x1},${y1}C${c1},${y1} ${c2},${y2} ${x2},${y2}`)
    }
    const updateWriteLine = (line: SVGLineElement,
                             {x: x1, y: y1}: Point,
                             {x: x2, y: y2}: Point,
                             locked: boolean): void => {
        line.x1.baseVal.value = x1
        line.y1.baseVal.value = y1
        if (locked) {
            const dx = x2 - x1
            const dy = y2 - y1
            const dd = 1.0 / Math.sqrt(dx * dx + dy * dy) * 3 // radius of pin
            line.x2.baseVal.value = x2 - dx * dd
            line.y2.baseVal.value = y2 - dy * dd
        } else {
            line.x2.baseVal.value = x2
            line.y2.baseVal.value = y2
        }
    }
    const updateConnection = ({box: {source, target}, uuid}: ModuleConnectionAdapter): void => {
        if (vitalSigns.isTerminated) {return}
        const view = connections.getOrNull(uuid)
        if (view === null || view.adapter.box.source !== source || view.adapter.box.target !== target) {return}
        const v1 = source.targetVertex.unwrapOrNull()
        const v2 = target.targetVertex.unwrapOrNull()
        if (v1 === null || v2 === null) {return}
        const p1 = environment.findConnectorViewOrNull(v1.address)
        const p2 = environment.findConnectorViewOrNull(v2.address)
        if (p1 === null || p2 === null) {return}
        updateWirePath(view.wire, p1.pinPoint, p2.pinPoint)
    }
    const updateQueue: Set<ModuleAdapter> = new Set()
    const updateDefer = lifecycle.own(deferNextFrame(() => {
        const connections: Set<ModuleConnectionAdapter> = new Set()
        updateQueue.forEach(moduleAdapter => {
            const collector = (connector: ModuleConnectorAdapter<Pointers, unknown>) =>
                connector.connections.forEach(connection => connections.add(connection))
            moduleAdapter.inputs.forEach(collector)
            moduleAdapter.outputs.forEach(collector)
        })
        updateQueue.clear()
        connections.forEach(connection => updateConnection(connection))
    }))
    const modules: SortedSet<UUID.Bytes, {
        uuid: UUID.Bytes,
        subscriptions: Subscription
    }> = UUID.newSet(entry => entry.uuid)
    lifecycle.own(environment.modularAdapter.catchupAndSubscribe({
        onModuleAdded: (adapter: ModuleAdapter) => {
            const enqueue = () => {
                updateQueue.add(adapter)
                updateDefer.request()
            }
            const subscriptions: Terminator = new Terminator()
            subscriptions.own(adapter.attributes.x.subscribe(enqueue))
            subscriptions.own(adapter.attributes.y.subscribe(enqueue))
            subscriptions.own(adapter.attributes.collapsed.subscribe(enqueue))
            modules.add({uuid: adapter.uuid, subscriptions})
            enqueue()
        },
        onModuleRemoved: (adapter: ModuleAdapter) => {
            modules.removeByKey(adapter.uuid).subscriptions.terminate()
            updateQueue.delete(adapter)
        },
        onConnectionAdded: (adapter: ModuleConnectionAdapter) => {
            const wire: SVGPathElement = <path stroke={Colors.blue}/>
            wires.appendChild(wire)
            const view = {adapter, wire, pending: deferNextFrame(() => {
                if (connections.getOrNull(adapter.uuid) === view) {updateConnection(adapter)}
            })}
            const added = connections.add(view)
            assert(added, "Could not add connection")
            view.pending.request()
        },
        onConnectionRemoved: (adapter: ModuleConnectionAdapter) => {
            const view = connections.removeByKey(adapter.uuid)
            view.pending.terminate()
            view.wire.remove()
        }
    }))
    lifecycle.own({terminate: () => {
        vitalSigns.terminate()
        updateDefer.terminate()
        updateQueue.clear()
        modules.forEach(entry => entry.subscriptions.terminate())
        modules.clear()
        connections.forEach(view => {view.pending.terminate(); view.wire.remove()})
        connections.clear()
    }})
    lifecycle.own(Html.watchResize(svg, ({contentRect}) =>
        svg.setAttribute("viewBox", `0 0 ${contentRect.width} ${contentRect.height}`)))

    lifecycle.own(environment.setWiringPreview({
        begin: (connector: ConnectorViewAdapter, pointer: Point) => {
            const path: SVGLineElement = <line stroke={Colors.blue}/>
            wires.appendChild(path)
            updateWriteLine(path, connector.pinPoint, camera.globalToLocal(pointer.x, pointer.y), false)
            return ({
                update: (pointer: Point, locked: boolean) =>
                    updateWriteLine(path, connector.pinPoint, camera.globalToLocal(pointer.x, pointer.y), locked),
                terminate: () => path.remove()
            })
        },
        highlight: (connection: UUID.Bytes): Terminable => {
            const wire = connections.get(connection).wire
            wire.classList.add("highlight")
            return {terminate: () => wire.classList.remove("highlight")}
        }
    } satisfies WiringPreview))
    appendChildren(wires, (
        <g stroke="rgba(255, 255, 255, 0.1)">
            <line x1={-3} x2={3} y1={0} y2={0}/>
            <line x1={0} x2={0} y1={-3} y2={3}/>
        </g>
    ))
    return svg
}