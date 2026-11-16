import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {MutableObservableOption, Option, RuntimeNotifier, Terminator, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, SoundfontDeviceBox} from "@opendaw/studio-boxes"
import {DeviceHost, ProjectSkeleton, Soundfont, SoundfontDeviceBoxAdapter} from "@opendaw/studio-adapters"
import type {StudioService} from "@/service/StudioService"
import {SoundfontDeviceEditor} from "./SoundfontDeviceEditor"
import {MenuButton} from "@/ui/components/MenuButton"
vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("./SoundfontDeviceEditor.sass?inline", () => ({default: "component {}"}))
vi.mock("@/ui/devices/DeviceEditor.tsx", () => ({DeviceEditor: ({populateControls}: {populateControls: () => HTMLElement}) => populateControls()}))
vi.mock("@/ui/devices/menu-items.ts", () => ({MenuItems: {}}))
vi.mock("@/ui/devices/panel/DevicePeakMeter.tsx", () => ({DevicePeakMeter: () => document.createElement("div")}))
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("div")}))
vi.mock("@/ui/components/MenuButton", () => ({MenuButton: vi.fn(() => document.createElement("div"))}))
const flush = async () => {for (let i = 0; i < 20; i++) {await Promise.resolve()}}
const font = {uuid: UUID.toString(UUID.generate()), name: "Synthetic"} as Soundfont
const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(boxGraph)
    const box = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        return SoundfontDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(unit.input))
    }).unwrap()
    const adapter = {box, namedParameter: {}, loader: new MutableObservableOption(),
        soundfont: new MutableObservableOption(), preset: new MutableObservableOption()} as unknown as SoundfontDeviceBoxAdapter
    const pending = Promise.withResolvers<ReadonlyArray<Soundfont>>()
    const project = {boxGraph, editing}
    const service = {project, optProject: Option.wrap(project), soundfontService: {remote: Option.None, local: Option.None,
        browse: vi.fn(() => pending.promise)}} as unknown as StudioService
    const lifecycle = new Terminator()
    SoundfontDeviceEditor({lifecycle, service, adapter, deviceHost: {} as DeviceHost})
    const root = vi.mocked(MenuButton).mock.calls.at(-2)![0].root
    const trigger = () => root.collectChildren().at(-1)!.trigger()
    return {box, boxGraph, editing, lifecycle, pending, trigger, service}
}
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
it.each(["editor", "device", "project"])("ignores imported fonts after %s retirement", async kind => {
    const f = fixture(); f.trigger()
    if (kind === "editor") {f.lifecycle.terminate()}
    if (kind === "device") {f.editing.modify(() => f.box.delete())}
    if (kind === "project") {Object.assign(f.service, {optProject: Option.None})}
    const before = new Uint8Array(f.boxGraph.toArrayBuffer()); f.pending.resolve([font]); await flush()
    expect(new Uint8Array(f.boxGraph.toArrayBuffer())).toEqual(before)
})
it("applies a current import and reports an active failure once", async () => {
    const f = fixture(); f.trigger(); f.pending.resolve([font]); await flush()
    expect(f.box.file.targetAddress.unwrap().uuid).toEqual(UUID.parse(font.uuid))
    const info = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
    const failed = fixture(); failed.trigger(); failed.pending.reject(new Error("synthetic")); await flush()
    expect(info).toHaveBeenCalledTimes(1)
})
