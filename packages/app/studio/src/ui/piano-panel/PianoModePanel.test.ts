import {afterEach, expect, it, vi} from "vitest"
import {AudioUnitType} from "@opendaw/studio-enums"
import {BoxEditing} from "@opendaw/lib-box"
import {DefaultObservableValue, Terminator, UUID} from "@opendaw/lib-std"
import {BoxAdapters, BoxAdaptersContext, ParameterFieldAdapters, ProjectSkeleton, RootBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {AudioUnitBox, TrackBox} from "@opendaw/studio-boxes"
import {PianoModePanel} from "./PianoModePanel"
import {StudioService} from "@/service/StudioService"

vi.hoisted(() => {document.adoptedStyleSheets = []; globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet})

vi.mock("./NoteFall.tsx", () => ({NoteFall: () => document.createElement("div")}))
vi.mock("./PianoRoll.tsx", () => ({PianoRoll: () => document.createElement("div")}))
vi.mock("@/ui/components/Icon.tsx", () => ({Icon: () => document.createElement("span")}))
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "piano-test"},
        ShortcutManager: {get: () => ({createContext: () => ({terminate() {}, register: () => ({terminate() {}})})})}}
})
afterEach(() => vi.restoreAllMocks())

const setup = () => {
    const {boxGraph, mandatoryBoxes: {rootBox}} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const context = {boxGraph, parameterFieldAdapters: new ParameterFieldAdapters()} as BoxAdaptersContext
    Object.assign(context, {boxAdapters: new BoxAdapters(context)})
    const root = context.boxAdapters.adapterFor(rootBox, RootBoxAdapter)
    Object.assign(context, {rootBoxAdapter: root})
    const unit = root.audioUnits.adapters()[0].box
    const editing = new BoxEditing(boxGraph)
    const add = (index: number) => editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(TrackType.Notes); box.index.setValue(index)
        box.tracks.refer(unit.tracks); box.target.refer(unit)
    })).unwrap()
    const first = add(0)
    let fieldSubscriptions = 0
    const subscribe = first.excludePianoMode.subscribe.bind(first.excludePianoMode)
    vi.spyOn(first.excludePianoMode, "subscribe").mockImplementation(observer => {
        fieldSubscriptions++
        const subscription = subscribe(observer)
        let active = true
        return {terminate: () => {
            if (!active) {return}
            active = false
            fieldSubscriptions--
            subscription.terminate()
        }}
    })
    const lifecycle = new Terminator()
    const service = {hasProfile: true, project: {rootBoxAdapter: root, editing,
        engine: {position: new DefaultObservableValue(0)}}} as unknown as StudioService
    const panel = PianoModePanel({lifecycle, service}) as HTMLElement
    return {boxGraph, root, unit, editing, add, first, lifecycle, panel, service, fieldSubscriptions: () => fieldSubscriptions}
}

it("retires the current exclusion chain after repeated replacements and reopen", () => {
    const {first, editing, root, lifecycle, service, fieldSubscriptions} = setup()
    const units = vi.spyOn(root.audioUnits, "catchupAndSubscribe")
    for (let index = 0; index < 4; index++) {
        editing.modify(() => first.excludePianoMode.setValue(!first.excludePianoMode.getValue()))
    }
    lifecycle.terminate()
    expect(fieldSubscriptions()).toBe(0)
    units.mockClear()
    editing.modify(() => first.excludePianoMode.setValue(!first.excludePianoMode.getValue()))
    expect(units).not.toHaveBeenCalled()
    const reopened = new Terminator()
    PianoModePanel({lifecycle: reopened, service})
    reopened.terminate()
    expect(fieldSubscriptions()).toBe(0)
    units.mockClear()
    editing.modify(() => first.excludePianoMode.setValue(!first.excludePianoMode.getValue()))
    expect(units).not.toHaveBeenCalled()
})

it("keeps controls in current membership/order and retires removed track controls", () => {
    const {panel, first, add, editing, unit, lifecycle} = setup()
    const controls = () => Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).slice(1)
    expect(controls()).toHaveLength(1)
    const second = add(1)
    expect(controls()).toHaveLength(2)
    editing.modify(() => second.excludePianoMode.setValue(true))
    expect(controls().map(input => input.checked)).toEqual([true, false])
    editing.modify(() => {second.index.setValue(0); first.index.setValue(1)})
    expect(controls().map(input => input.checked)).toEqual([false, true])
    const retired = controls()[0]
    editing.modify(() => second.delete())
    expect(controls()).toHaveLength(1)
    expect(retired.isConnected).toBe(false)
    editing.modify(() => first.delete())
    expect(controls()).toHaveLength(0)
    expect(panel.querySelector('.no-midi-track-label')?.classList.contains("hidden")).toBe(false)
    editing.modify(() => unit.delete())
    expect(controls()).toHaveLength(0)
    lifecycle.terminate()
})

it("follows added, reordered and removed audio units while the panel stays open", () => {
    const {boxGraph, root, editing, panel, lifecycle} = setup()
    const controls = () => Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).slice(1)
    const addedUnit = editing.modify(() => AudioUnitBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(AudioUnitType.Output)
        box.collection.refer(root.box.audioUnits)
        box.output.refer(root.box.outputDevice)
        box.index.setValue(1)
    })).unwrap()
    editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), box => {
        box.type.setValue(TrackType.Notes); box.tracks.refer(addedUnit.tracks); box.target.refer(addedUnit)
        box.excludePianoMode.setValue(true)
    }))
    expect(controls().map(input => input.checked)).toEqual([true, false])
    editing.modify(() => addedUnit.index.setValue(-1))
    expect(controls().map(input => input.checked)).toEqual([false, true])
    editing.modify(() => addedUnit.delete())
    expect(controls().map(input => input.checked)).toEqual([true])
    lifecycle.terminate()
})
