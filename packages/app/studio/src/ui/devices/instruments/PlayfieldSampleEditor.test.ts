import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Terminator, UUID} from "@opendaw/lib-std"
import {DeviceHost, NoteSignal, PlayfieldSampleBoxAdapter} from "@opendaw/studio-adapters"
import type {StudioService} from "@/service/StudioService"
import {PlayfieldSampleEditor} from "./PlayfieldSampleEditor"
vi.hoisted(() => {
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("./PlayfieldSampleEditor.sass?inline", () => ({default: "component {}"}))
vi.mock("@/ui/devices/DeviceEditor.tsx", () => ({DeviceEditor: ({createLabel}: {createLabel: () => HTMLElement}) => createLabel()}))
vi.mock("@/ui/devices/menu-items.ts", () => ({MenuItems: {}}))
vi.mock("@/ui/devices/panel/DevicePeakMeter.tsx", () => ({DevicePeakMeter: () => document.createElement("div")}))
vi.mock("@/ui/devices/instruments/PlayfieldDeviceEditor/SlotEditor", () => ({SlotEditor: () => document.createElement("div")}))
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("div")}))
vi.mock("@/ui/surface/TextTooltip", () => ({TextTooltip: {default: () => ({terminate() {}})}}))
afterEach(() => vi.restoreAllMocks())
it("balances replaced pointers and ignores releases from the previous pointer", () => {
    const lifecycle = new Terminator(), signals: NoteSignal[] = []
    const adapter = {device: () => ({labelField: new DefaultObservableValue("Synthetic")}),
        labelField: new DefaultObservableValue("Pad"), indexField: new DefaultObservableValue(60)} as unknown as PlayfieldSampleBoxAdapter
    const service = {project: {engine: {noteSignal: (signal: NoteSignal) => signals.push(signal)}}} as unknown as StudioService
    const deviceHost = {audioUnitBoxAdapter: () => ({uuid: UUID.generate()})} as unknown as DeviceHost
    const ui = PlayfieldSampleEditor({lifecycle, service, adapter, deviceHost}) as HTMLElement
    const play = ui.querySelector<HTMLElement>(".play-label")!
    play.setPointerCapture = vi.fn(); play.releasePointerCapture = vi.fn(); play.hasPointerCapture = () => true
    const send = (type: string, pointerId: number) => {
        const event = new Event(type); Object.assign(event, {pointerId}); play.dispatchEvent(event)
    }
    send("pointerdown", 1); send("pointerdown", 2)
    expect(signals.map(signal => signal.type)).toEqual(["note-on", "note-off", "note-on"])
    send("pointerup", 1); expect(signals).toHaveLength(3)
    send("pointercancel", 2); send("lostpointercapture", 2); expect(signals).toHaveLength(4)
    send("pointerdown", 3); send("lostpointercapture", 3); expect(signals).toHaveLength(6)
    send("pointerdown", 4); lifecycle.terminate(); send("pointerup", 4)
    expect(signals.map(signal => signal.type)).toEqual(Array.from({length: 8}, (_, i) => i % 2 ? "note-off" : "note-on"))
})
