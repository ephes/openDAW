import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Option, Terminable, Terminator} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"
import type {PlayfieldSampleBoxAdapter} from "@opendaw/studio-adapters"
import {Dragging} from "@opendaw/lib-dom"
import {SlotEditor} from "./SlotEditor"

const recording = vi.hoisted(() => ({draw: vi.fn(), update: vi.fn()}))
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix}}
})
vi.mock("@opendaw/studio-core", () => ({CanvasPainter: class {
    requestUpdate = recording.update
    constructor(_: unknown, draw: (p: unknown) => void) {recording.update.mockImplementation(() => draw(this)); draw(this)}
    terminate() {}
}}))
vi.mock("@/ui/devices/instruments/PlayfieldDeviceEditor/SlotUtils", () => ({SlotUtils: {waveform: (_: unknown, adapter: PlayfieldSampleBoxAdapter) => recording.draw(adapter.file().unwrapOrNull())}}))
vi.mock("@/ui/devices/SampleSelector", () => ({SampleSelector: class {configureDrop() {return {terminate() {}}}}, SampleSelectStrategy: {forPointerField() {}}}))
vi.mock("@/ui/components/Icon", () => ({Icon: () => null}))
vi.mock("@/ui/components/Checkbox", () => ({Checkbox: () => null}))
vi.mock("@/ui/components/AutomationControl", () => ({AutomationControl: () => null}))
vi.mock("@/ui/components/RadioGroup", () => ({RadioGroup: () => null}))
vi.mock("@/ui/components/ParameterLabel", () => ({ParameterLabel: () => null}))
vi.mock("@/ui/wrapper/RelativeUnitValueDragging", () => ({RelativeUnitValueDragging: () => null}))
const owners: Terminator[] = []
afterEach(() => {owners.splice(0).forEach(owner => owner.terminate()); vi.restoreAllMocks(); recording.draw.mockClear(); recording.update.mockReset()})
const loader = () => {
    const observers = new Set<(state: {type: string}) => void>()
    return {observers, getOrCreateLoader: () => ({subscribe: (observer: (state: {type: string}) => void) => {
        observers.add(observer); return {terminate: () => {observers.delete(observer)}}
    }}), settle: () => observers.forEach(observer => observer({type: "loaded"}))}
}
const fixture = (start = 0.2, end = 0.8) => {
    const lifecycle = new Terminator(); owners.push(lifecycle)
    const a = loader(), b = loader()
    let file: typeof a | undefined = a
    const pointer = new DefaultObservableValue(0)
    const sampleStart = new DefaultObservableValue(start), sampleEnd = new DefaultObservableValue(end)
    const edit = {modify: (change: () => void) => change(), mark: vi.fn(), revertPending: vi.fn(() => {
        sampleStart.setValue(start); sampleEnd.setValue(end)
    })}
    const adapter = {device: () => ({deviceHost: () => ({audioUnitBoxAdapter: () => ({tracks: {}})})}), file: () => Option.wrap(file), box: {file: pointer, device: {subscribe: () => Terminable.Empty}},
        indexField: new DefaultObservableValue(0), namedParameter: {
            sampleStart, sampleEnd, attack: sampleStart, release: sampleStart, pitch: sampleStart, mute: sampleStart, solo: sampleStart, exclude: sampleStart, gate: sampleStart, polyphone: sampleStart
        }} as unknown as PlayfieldSampleBoxAdapter
    const service = {project: {editing: edit, liveStreamReceiver: {subscribeFloats: () => Terminable.Empty}}} as unknown as StudioService
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {return {canvas: this} as CanvasRenderingContext2D})
    const attach = vi.spyOn(Dragging, "attach").mockReturnValue(Terminable.Empty)
    const element = SlotEditor({lifecycle, service, adapter}) as HTMLElement
    const canvas = element.querySelector("canvas")!
    let width = 100
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => ({left: 10, width}) as DOMRect)
    return {lifecycle, a, b, sampleStart, sampleEnd, edit,
        width: (value: number) => {width = value},
        select: (value?: typeof a) => {file = value; pointer.setValue(pointer.getValue() + 1)},
        grab: (x: number) => attach.mock.calls[0][1]({clientX: x} as PointerEvent).unwrap()}
}
it.each([0.2, 0.8].flatMap(start => ["start", "end"].flatMap(handle => [-2, 2].map(offset => ({start, handle, offset})))))(
    "preserves signed grab offset $start/$handle/$offset, movement, cancellation and resizing", ({start, handle, offset}) => {
        const end = 1 - start, f = fixture(start, end)
        const parameter = handle === "start" ? f.sampleStart : f.sampleEnd
        const original = parameter.getValue(), x = 10 + original * 100 + offset
        const drag = f.grab(x)
        drag.update({clientX: x} as Dragging.Event); expect(parameter.getValue()).toBeCloseTo(original)
        drag.update({clientX: x + 10} as Dragging.Event); expect(parameter.getValue()).toBeCloseTo(original + 0.1)
        f.width(200); drag.update({clientX: 10 + original * 200 + offset} as Dragging.Event)
        expect(parameter.getValue()).toBeCloseTo(original)
        drag.cancel(); expect(parameter.getValue()).toBe(original)
        drag.approve(); expect(f.edit.mark).toHaveBeenCalledTimes(1)
    })
it("chooses the nearest near-coincident handle and clamps the result", () => {
    const f = fixture(0.79, 0.8)
    const drag = f.grab(90.5)
    drag.update({clientX: 300} as Dragging.Event)
    expect(f.sampleEnd.getValue()).toBe(1); expect(f.sampleStart.getValue()).toBe(0.79)
})
it("observes only the selected loader, including initial load and parent teardown", () => {
    const f = fixture()
    expect(f.a.observers.size).toBe(1)
    const before = recording.update.mock.calls.length
    f.a.settle(); expect(recording.update.mock.calls.length).toBe(before + 1)
    f.select(f.b)
    expect(f.a.observers.size).toBe(0); expect(f.b.observers.size).toBe(1)
    const switched = recording.update.mock.calls.length
    f.a.settle(); expect(recording.update.mock.calls.length).toBe(switched)
    f.b.settle(); expect(recording.draw).toHaveBeenLastCalledWith(f.b)
    f.select(); expect(f.b.observers.size).toBe(0)
    f.select(f.a); f.lifecycle.terminate()
    expect(f.a.observers.size).toBe(0)
    const retired = recording.update.mock.calls.length
    f.a.settle(); f.b.settle(); expect(recording.update.mock.calls.length).toBe(retired)
})
