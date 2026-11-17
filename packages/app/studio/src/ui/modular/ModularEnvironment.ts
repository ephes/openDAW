import {
    assert,
    isDefined,
    Nullable,
    Option,
    Point,
    Provider,
    Selection,
    SortedSet,
    Terminable,
    Terminator,
    UUID
} from "@opendaw/lib-std"
import {
    Direction,
    ModularAdapter,
    ModuleAdapter,
    ModuleConnectionAdapter,
    ModuleConnectorAdapter,
    Modules
} from "@opendaw/studio-adapters"
import {Address} from "@opendaw/lib-box"
import {Pointers} from "@opendaw/studio-enums"
import {ModuleConnectionBox} from "@opendaw/studio-boxes"
import {Camera} from "@/ui/modular/Camera.ts"
import {Events} from "@opendaw/lib-dom"
import {StudioService} from "@/service/StudioService"
import {Project} from "@opendaw/studio-core"

export type ModuleViewAdapter = {
    moduleView: Element
    moduleAdapter: ModuleAdapter
    lifecycle: Terminator
}

export class ConnectorViewAdapter {
    readonly #adapter: ModuleConnectorAdapter<Pointers, unknown>
    readonly #element: Element
    readonly #pinLocator: Provider<Point>

    constructor(adapter: ModuleConnectorAdapter<Pointers, unknown>, element: Element, pinLocator: Provider<Point>) {
        this.#adapter = adapter
        this.#element = element
        this.#pinLocator = pinLocator
    }

    get adapter(): ModuleConnectorAdapter<Pointers, unknown> {return this.#adapter}
    get element(): Element {return this.#element}
    get pinPoint(): Point {return this.#pinLocator()}

    toString(): string {return `{ConnectorViewAdapter adapter: ${this.#adapter}`}
}

export interface WiringPreview {
    begin(connector: ConnectorViewAdapter, pointer: Point): {
        update: (pointer: Point, locked: boolean) => void
    } & Terminable
    highlight(connection: UUID.Bytes): Terminable
}

export class ModularEnvironment implements Terminable {
    readonly #service: StudioService
    readonly #modularAdapter: ModularAdapter
    readonly #camera: Camera

    readonly #terminator: Terminator
    readonly #selection: Selection<ModuleAdapter>

    readonly #modules: SortedSet<UUID.Bytes, ModuleViewAdapter>
    readonly #connectors: SortedSet<Address, ConnectorViewAdapter>

    #wiringPreview: Option<WiringPreview> = Option.None

    #isWiring: boolean = false
    #gesture: Nullable<Terminator> = null
    #terminated = false

    constructor(service: StudioService, modularAdapter: ModularAdapter, camera: Camera) {
        this.#service = service
        this.#modularAdapter = modularAdapter
        this.#camera = camera

        this.#terminator = new Terminator()
        this.#selection = this.#terminator.own(this.#service.project.selection.createFilteredSelection(Modules.isVertexOfModule, {
            fx: (adapter: ModuleAdapter) => adapter.box,
            fy: vertex => Modules.adapterFor(this.#service.project.boxAdapters, vertex.box)
        }))
        this.#modules = UUID.newSet<ModuleViewAdapter>(viewAdapter => viewAdapter.moduleAdapter.uuid)
        this.#connectors = Address.newSet(view => view.adapter.address)

        this.#terminator.own(this.#selection.catchupAndSubscribe({
            onSelected: (adapter: ModuleAdapter) => {
                adapter.onSelected()
                this.#modules.getOrNull(adapter.uuid)?.moduleView.classList.add("selectable")
            },
            onDeselected: (adapter: ModuleAdapter) => {
                adapter.onDeselected()
                this.#modules.getOrNull(adapter.uuid)?.moduleView.classList.remove("selectable")
            }
        }))
    }

    setWiringPreview(preview: WiringPreview): Terminable {
        this.#gesture?.terminate()
        this.#wiringPreview = Option.wrap(preview)
        return {terminate: () => {
            if (this.#wiringPreview.unwrapOrNull() !== preview) {return}
            this.#gesture?.terminate()
            this.#wiringPreview = Option.None
        }}
    }

    registerModule(viewAdapter: ModuleViewAdapter): void {
        console.debug(`registerModule(${viewAdapter.toString()})`)
        const added = this.#modules.add(viewAdapter)
        assert(added, `Could not register viewAdapter ${viewAdapter.toString()}`)
        viewAdapter.moduleAdapter.attributes
    }

    unregisterModule(uuid: UUID.Bytes): void {
        console.debug(`unregisterModule(${UUID.toString(uuid)})`)
        this.#modules.removeByKey(uuid).lifecycle.terminate()
    }

    registerConnectorView(view: ConnectorViewAdapter): Terminable {
        console.debug(`registerConnector(${view.adapter.address.toString()})`)
        const added = this.#connectors.add(view)
        assert(added, `Could not register connector at ${view.toString()}`)
        return {terminate: () => this.#connectors.removeByKey(view.adapter.address)}
    }

    findConnectorByViewAddress(address: Address): ConnectorViewAdapter {return this.#connectors.get(address)}
    findConnectorViewOrNull(address: Address): Nullable<ConnectorViewAdapter> {return this.#connectors.getOrNull(address)}

    findConnectorViewByEventTarget(target: Nullable<EventTarget>): Nullable<ConnectorViewAdapter> {
        if (target === null) {return null}
        return this.#connectors.values().find(view => view.element === target) ?? null
    }

    findMatchingConnectorViews(adapter: ModuleConnectorAdapter<Pointers, unknown>): ReadonlyArray<ConnectorViewAdapter> {
        return this.#connectors
            .values()
            .filter(view => view.adapter.matches(adapter))
    }

    beginWiring(adapter: ModuleConnectorAdapter<Pointers, unknown>, pointer: Point): void {
        this.#beginWiring(adapter, pointer)
    }

    #beginWiring(adapter: ModuleConnectorAdapter<Pointers, unknown>, pointer: Point,
                 original?: ModuleConnectionAdapter): void {
        this.#gesture?.terminate()
        if (this.#terminated) {return}
        const matchingConnectors = this.findMatchingConnectorViews(adapter)
        const sourceView = this.#connectors.getOrNull(adapter.address)
        if (matchingConnectors.length === 0 || sourceView === null || this.#wiringPreview.isEmpty()) {return}
        const originalSource = original?.box.source.targetVertex.unwrapOrNull()
        const originalTarget = original?.box.target.targetVertex.unwrapOrNull()
        const runtime = new Terminator()
        this.#gesture = runtime
        this.#isWiring = true
        runtime.own({terminate: () => {
            if (this.#gesture !== runtime) {return}
            this.#gesture = null
            this.#isWiring = false
        }})
        try {
            matchingConnectors.forEach(connector => connector.element.classList.add("accepting"))
            runtime.own({terminate: () => matchingConnectors.forEach(connector => connector.element.classList.remove("accepting"))})
            const preview = runtime.own(this.#wiringPreview.unwrap().begin(sourceView, pointer))
            let lock: Option<ConnectorViewAdapter> = Option.None
            const owner = sourceView.element.ownerDocument.defaultView!
            runtime.own(Events.subscribe(owner, "pointerover", event => {
                const view = this.findConnectorViewByEventTarget(event.target)
                lock = isDefined(view) && matchingConnectors.includes(view) ? Option.wrap(view) : Option.None
            }, {capture: true}))
            runtime.own(Events.subscribe(owner, "pointermove", event => preview.update(lock.match({
                none: () => Point.fromClient(event),
                some: ({pinPoint: {x, y}}) => this.#camera.localToGlobal(x, y)
            }), lock.nonEmpty()), {capture: true}))
            runtime.own(Events.subscribe(owner, "pointerup", event => {
                try {
                    const view = this.findConnectorViewByEventTarget(event.target)
                    if (isDefined(view) && matchingConnectors.includes(view)
                        && (!original || (original.box.source.targetVertex.unwrapOrNull() === originalSource
                            && original.box.target.targetVertex.unwrapOrNull() === originalTarget))) {
                        this.#connect(adapter, view.adapter, original)
                    }
                } finally {runtime.terminate()}
            }, {capture: true}))
            runtime.own(Events.subscribe(owner, "pointercancel", () => runtime.terminate(), {capture: true}))
            runtime.own(Events.subscribe(owner, "blur", () => runtime.terminate()))
        } catch (error) {
            runtime.terminate()
            throw error
        }
    }

    beginRewiring(connection: ModuleConnectionAdapter, connectorAdapter: ModuleConnectorAdapter<Pointers, unknown>, pointer: Point) {
        const vertex = connection.source.address.equals(connectorAdapter.address) ? connection.target : connection.source
        const connector = this.#connectors.getOrNull(vertex.address)
        if (connector === null) {this.#gesture?.terminate(); return}
        this.#beginWiring(connector.adapter, pointer, connection)
    }

    highlightWire(connection: ModuleConnectionAdapter): Terminable {
        return this.#wiringPreview.match({
            none: () => Terminable.Empty,
            some: preview => preview.highlight(connection.uuid)
        })
    }

    get isWiring(): boolean {return this.#isWiring}
    get service(): StudioService {return this.#service}
    get project(): Project {return this.#service.project}
    get selection(): Selection<ModuleAdapter> {return this.#selection}
    get modularAdapter(): ModularAdapter {return this.#modularAdapter}

    terminate(): void {
        this.#terminated = true
        this.#gesture?.terminate()
        this.#wiringPreview = Option.None
        this.#modules.forEach(entry => entry.lifecycle.terminate())
        this.#modules.clear()
        this.#terminator.terminate()
    }

    #connect(adapter: ModuleConnectorAdapter<Pointers, unknown>, other: ModuleConnectorAdapter<Pointers, unknown>, original?: ModuleConnectionAdapter): void {
        if (adapter === other) {
            console.debug("Cannot connect same connector")
            return
        }
        if (!adapter.matches(other)) {
            console.debug("Cannot connect mismatching connectors")
            return
        }
        const {editing, boxGraph} = this.#service.project
        const owns = (connector: ModuleConnectorAdapter<Pointers, unknown>) =>
            boxGraph.findBox(connector.address.uuid).unwrapOrNull() === connector.field.box
            && this.#modularAdapter.modules.some(module => module.box === connector.field.box)
            && this.#connectors.getOrNull(connector.address)?.adapter === connector
        if (!owns(adapter) || !owns(other)) {return}
        if (original && (!this.#modularAdapter.connections.includes(original)
            || boxGraph.findBox(original.uuid).unwrapOrNull() !== original.box)) {return}
        const source = adapter.direction === Direction.Output ? adapter : other
        const target = other.direction === Direction.Input ? other : adapter
        if (source.connections.some(connection => connection.box.target.targetVertex.unwrap().address.equals(target.address))) {
            // TODO showInfoDialog("Connection already exists")
            return
        }
        editing.modify(() => {
            original?.box.delete()
            ModuleConnectionBox.create(boxGraph, UUID.generate(), box => {
                box.collection.refer(this.#modularAdapter.box.connections)
                box.source.refer(source.field)
                box.target.refer(target.field)
            })
        })
    }
}