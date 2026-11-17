import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {DefaultObservableValue, MutableObservableOption, Option, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, DelayDeviceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import type {StudioService} from "@/service/StudioService"
import {DevicePanel} from "./DevicePanel"
import {NumberInput} from "@/ui/components/NumberInput"

vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix,
        watchResize: () => ({terminate() {}})},
        deferNextFrame: () => ({request() {}, terminate() {}})}
})
vi.mock("@/ui/components/Scroller", () => ({Orientation: {}, Scroller: () => document.createElement("div")}))
vi.mock("@/ui/devices/panel/DeviceMidiMeter.tsx", () => ({DeviceMidiMeter: () => document.createElement("div")}))
vi.mock("@/ui/mixer/ChannelStrip", () => ({ChannelStrip: () => document.createElement("div")}))
vi.mock("@/ui/AutoScroll", () => ({installAutoScroll: () => ({terminate() {}})}))
vi.mock("@/ui/devices/DevicePanelDragAndDrop", () => ({DevicePanelDragAndDrop: {install: () => ({terminate() {}})}}))
vi.mock("@/ui/devices/panel/ShadertoyPreview", () => ({ShadertoyPreview: () => document.createElement("div")}))
const counts = vi.hoisted(() => ({live: 0, created: 0}))
vi.mock("@/ui/devices/panel/DeviceMount", () => ({DeviceMount: {
    forAudioEffect: (_: unknown, adapter: {uuid: UUID.Bytes}) => {
        counts.live++; counts.created++
        let active = true
        return {uuid: adapter.uuid, editor: () => document.createElement("header"), terminate: () => {
            if (active) {counts.live--; active = false}
        }}
    }
}}))
const owners: Terminator[] = []
afterEach(() => {owners.splice(0).forEach(owner => owner.terminate()); document.body.replaceChildren(); vi.restoreAllMocks()})

const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(boxGraph)
    const {unit, first, second} = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const effect = (index: number) => DelayDeviceBox.create(boxGraph, UUID.generate(), box => {
            box.host.refer(unit.audioEffects); box.index.setValue(index)
        })
        return {unit, first: effect(0), second: effect(1)}
    }).unwrap()
    const effects = [first, second].map(box => ({uuid: box.address.uuid, type: "audio-effect", box, indexField: box.index}))
    const audioUnit = new MutableObservableOption<{box: AudioUnitBox}>()
    audioUnit.wrap({box: unit})
    const host = {audioEffects: {adapters: () => effects, catchupAndSubscribe: (observer: {onAdd: (adapter: unknown) => void}) => {
        effects.forEach(observer.onAdd); return Terminable.Empty
    }}, midiEffects: {adapters: () => [], catchupAndSubscribe: () => Terminable.Empty},
        audioUnitBoxAdapter: () => ({input: {adapter: () => new MutableObservableOption()}})}
    const project = {editing, boxAdapters: {adapterFor: () => host}, userEditingManager: {audioUnit: {get: () => audioUnit, catchupAndSubscribe: audioUnit.catchupAndSubscribe.bind(audioUnit)}},
        audioUnitFreeze: {subscribe: () => Terminable.Empty, isFrozen: () => false},
        deviceSelection: {isEmpty: () => false, selected: () => [effects[0]]}}
    const profile = new MutableObservableOption<{project: typeof project}>()
    profile.wrap({project})
    const profiles = {getValue: () => profile, catchupAndSubscribe: profile.catchupAndSubscribe.bind(profile),
        setValue: (value: Option<{project: typeof project}>) => profile.wrapOption(value)}
    const service = {project, projectProfileService: profiles} as unknown as StudioService
    const mount = () => {
        const lifecycle = new Terminator(); owners.push(lifecycle)
        const element = DevicePanel({lifecycle, service}) as HTMLElement
        document.body.append(element)
        return {element, lifecycle}
    }
    editing.clear()
    return {project, profiles, audioUnit, mount, editing, first, second, boxGraph}
}

it("retires profile selection subscriptions before switching and on panel remount", () => {
    const f = fixture()
    counts.created = 0
    const first = f.mount()
    expect(counts.live).toBe(2)
    first.lifecycle.terminate(); expect(counts.live).toBe(0)
    const second = f.mount()
    const created = counts.created
    const target = f.audioUnit.unwrap()
    f.audioUnit.clear(); f.audioUnit.wrap(target)
    expect(counts.live).toBe(2)
    expect(counts.created - created).toBe(2)
    f.profiles.setValue(Option.None)
    expect(counts.live).toBe(0)
    const retired = counts.created
    f.audioUnit.clear()
    // Replacing selection in the retired project cannot construct another chain.
    f.audioUnit.wrap(target)
    expect(counts.created).toBe(retired)
    second.lifecycle.terminate()
})

it("keeps NumberInput editing, IME and handled events away from deletion; header deletion is undoable", () => {
    const f = fixture(), panel = f.mount()
    const number = NumberInput({lifecycle: panel.lifecycle, model: new DefaultObservableValue(123)}) as HTMLElement
    const input = number.querySelector<HTMLElement>("[contenteditable]")!
    // jsdom does not implement inherited isContentEditable; Chromium covers it too.
    Object.defineProperty(input, "isContentEditable", {value: true})
    panel.element.append(number)
    const send = (target: HTMLElement, code: string, composing = false, handled = false) => {
        const event = new KeyboardEvent("keydown", {key: code, code, bubbles: true, cancelable: true, isComposing: composing})
        if (handled) {event.preventDefault()}
        target.dispatchEvent(event)
        return event
    }
    const header = document.createElement("header"); panel.element.append(header)
    send(input, "Backspace"); send(input, "Delete")
    send(header, "Backspace", true); send(header, "Delete", false, true)
    expect(f.editing.canUndo()).toBe(false)
    expect(f.first.host.isAttached()).toBe(true)
    expect(send(header, "Delete").defaultPrevented).toBe(true)
    expect(f.second.index.getValue()).toBe(0)
    expect(f.editing.canUndo()).toBe(true)
    f.editing.undo()
    expect(f.boxGraph.findBox(f.first.address.uuid).nonEmpty()).toBe(true)
    expect(f.second.index.getValue()).toBe(1)
    expect(f.editing.canUndo()).toBe(false)
})
