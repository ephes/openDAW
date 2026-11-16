import {afterEach, expect, it, vi} from "vitest"
import {EventCollection, PPQN} from "@opendaw/lib-dsp"
import {WarpMarkerBox} from "@opendaw/studio-boxes"
import {Dragging, Events} from "@opendaw/lib-dom"
import {Editing, Option, Terminable} from "@opendaw/lib-std"
import {TransientMarkerBoxAdapter, WarpMarkerBoxAdapter} from "@opendaw/studio-adapters"
import {WarpMarkerEditing} from "./WarpMarkerEditing"

vi.mock("@/ui/menu/debug", () => ({DebugMenus: {}}))
vi.mock("@opendaw/studio-core", () => ({
    ContextMenu: {subscribe: () => Terminable.Empty},
    ElementCapturing: class {
        constructor(_element: Element, readonly strategy: {capture(x: number, y: number): unknown}) {}
        captureEvent(event: {clientX: number, clientY: number}) {return this.strategy.capture(event.clientX, event.clientY)}
    }
}))
afterEach(() => vi.restoreAllMocks())

const setup = () => {
    const markers = EventCollection.create<WarpMarkerBoxAdapter>()
    const add = (initial: number) => {
        let position = initial, attached = true
        const marker = {get position() {return position}, seconds: initial / 1000,
            box: {isAttached: () => attached, position: {setValue: (value: number) => {
                position = value; markers.onIndexingChanged()
            }}}} as unknown as WarpMarkerBoxAdapter
        markers.add(marker)
        return {marker, move: (value: number) => marker.box.position.setValue(value),
            remove: () => {attached = false; markers.remove(marker)}}
    }
    const left = add(0), target = add(1000), right = add(2000)
    let process!: Dragging.Process
    vi.spyOn(Dragging, "attach").mockImplementation((_element, factory) => {
        process = factory({clientX: 1000, clientY: 0} as PointerEvent).unwrap()
        return {terminate: () => process.cancel?.()}
    })
    let doubleDown!: (event: PointerEvent) => void
    vi.spyOn(Events, "subscribeDblDwn").mockImplementation((_element, listener) => {
        doubleDown = listener
        return Terminable.Empty
    })
    const transients = EventCollection.create<TransientMarkerBoxAdapter>()
    let hover: TransientMarkerBoxAdapter | null = null
    const selection = {terminate() {}, deselectAll() {}, select() {}, catchupAndSubscribe: () => Terminable.Empty}
    const editing = {...Editing.Transient, modify: vi.fn(Editing.Transient.modify), mark: vi.fn()}
    const project = {editing, selection: {createFilteredSelection: () => selection}}
    const reader = {offset: 0, audioContent: {file: {transients}, waveformOffset: {getValue: () => 0}, optWarpMarkers: Option.wrap(markers),
        observableOptPlayMode: {map: () => Option.None}}}
    const args = [project, document.createElement("canvas"), {xToUnit: (x: number) => x, unitToX: (x: number) => x},
        {xToUnitRound: (x: number) => x}, reader, {warpMarkers: markers}, {getValue: () => hover}]
    const owner = WarpMarkerEditing.install(...args as Parameters<typeof WarpMarkerEditing.install>)
    const move = (x: number) => process.update({clientX: x, clientY: 0, shiftKey: true, ctrlKey: false, altKey: false})
    return {doubleDown, transients, setHover: (value: TransientMarkerBoxAdapter) => {hover = value}, markers, add, left, target, right, process, editing, owner, move}
}

it("rechecks inserted, moved and deleted neighbors on approval", () => {
    const h = setup()
    h.move(1800)
    const inserted = h.add(1500)
    h.process.approve!()
    expect(h.target.marker.position).toBe(1500 - PPQN.SemiQuaver)
    expect(h.markers.asArray().map(marker => marker.position)).toEqual([0, 1500 - PPQN.SemiQuaver, 1500, 2000])
    inserted.remove()
})

it("uses current neighbors on every move and refuses an undersized interval", () => {
    const h = setup()
    h.move(1800)
    h.right.move(1100)
    h.move(1800)
    h.left.move(900)
    h.process.approve!()
    expect(h.target.marker.position).toBe(1000)
})

it.each(["cancel", "dispose"])("%s discards the preview without history or graph changes", action => {
    const h = setup()
    h.move(1600)
    expect(h.target.marker.position).toBe(1000)
    if (action === "dispose") {h.owner.terminate()} else {h.process.cancel!()}
    expect(h.target.marker.position).toBe(1000)
    expect(h.editing.modify).not.toHaveBeenCalled()
    expect(h.editing.mark).not.toHaveBeenCalled()
})

it.each(["cancel", "approve"])("%s preserves an intervening edit of the dragged marker", action => {
    const h = setup()
    h.move(1600)
    h.target.move(1100)
    if (action === "cancel") {h.process.cancel!()} else {h.process.approve!()}
    expect(h.target.marker.position).toBe(1100)
})

it("never writes a retired marker", () => {
    const h = setup()
    h.target.remove()
    h.move(1600)
    h.process.approve!()
    expect(h.target.marker.position).toBe(1000)
})

it("accepts the remaining current neighbor after deletion", () => {
    const h = setup()
    h.move(1800)
    h.right.remove()
    h.process.approve!()
    expect(h.target.marker.position).toBe(1760)
})

it.each(["removed", "replaced", "detached"])("refuses %s transient analysis cached by hover", state => {
    const h = setup()
    const transient = {position: 0.5, box: {isAttached: () => state !== "detached"}} as unknown as TransientMarkerBoxAdapter
    h.setHover(transient)
    if (state === "detached") {h.transients.add(transient)}
    if (state === "replaced") {h.transients.add({position: 0.5} as TransientMarkerBoxAdapter)}
    const create = vi.spyOn(WarpMarkerBox, "create").mockReturnValue({} as WarpMarkerBox)
    h.doubleDown({clientX: 500, clientY: 0, shiftKey: true} as PointerEvent)
    expect(create).not.toHaveBeenCalled()
})

it("creates from current attached transient analysis only with valid warp geometry", () => {
    const h = setup()
    const transient = {position: 0.5, box: {isAttached: () => true}} as unknown as TransientMarkerBoxAdapter
    h.transients.add(transient)
    h.setHover(transient)
    const create = vi.spyOn(WarpMarkerBox, "create").mockReturnValue({} as WarpMarkerBox)
    h.doubleDown({clientX: 500, clientY: 0, shiftKey: true} as PointerEvent)
    expect(create).toHaveBeenCalledTimes(1)
    Object.defineProperty(h.target.marker, "seconds", {value: 0})
    h.doubleDown({clientX: 500, clientY: 0, shiftKey: true} as PointerEvent)
    expect(create).toHaveBeenCalledTimes(1)
})
