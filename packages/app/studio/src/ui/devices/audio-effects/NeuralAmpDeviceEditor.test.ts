import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Option, Terminator, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NeuralAmpDeviceBox, NeuralAmpModelBox} from "@opendaw/studio-boxes"
import {DeviceHost, NeuralAmpDeviceBoxAdapter, ProjectSkeleton} from "@opendaw/studio-adapters"
import type {StudioService} from "@/service/StudioService"
import {NeuralAmpDeviceEditor} from "./NeuralAmpDeviceEditor"
import {NamTone3000, PackMeta, readPackMetaFromId, scanCachedModels} from "./NeuralAmp/NamTone3000"
import {MenuButton} from "@/ui/components/MenuButton"
import {IconSymbol} from "@opendaw/studio-enums"

vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("./NeuralAmpDeviceEditor.sass?inline", () => ({default: "component {}"}))
vi.mock("@/ui/devices/DeviceEditor.tsx", () => ({DeviceEditor: ({populateControls}: {populateControls: () => HTMLElement}) => populateControls()}))
vi.mock("@/ui/devices/menu-items.ts", () => ({MenuItems: {}}))
vi.mock("@/ui/devices/panel/DevicePeakMeter.tsx", () => ({DevicePeakMeter: () => document.createElement("div")}))
vi.mock("@/ui/devices/ControlBuilder", () => ({ControlBuilder: {createKnob: () => document.createElement("div")}}))
vi.mock("@/ui/components/Checkbox.tsx", () => ({Checkbox: () => document.createElement("div")}))
vi.mock("@/ui/components/Button", () => ({Button: () => document.createElement("div")}))
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("div")}))
vi.mock("@/ui/components/MenuButton", () => ({MenuButton: vi.fn(() => document.createElement("div"))}))
vi.mock("./NeuralAmp/NamLocal", () => ({NamLocal: {browse: () => () => {}}}))
vi.mock("./NeuralAmp/NamModelDialog", () => ({showNamModelDialog() {}}))
vi.mock("./NeuralAmp/SpectrumRenderer", () => ({createSpectrumRenderer: () => ({terminate() {}})}))
vi.mock("./NeuralAmp/NamTone3000", () => ({NamTone3000: {browse: () => () => {}, loadModelFromPack: vi.fn()},
    readPackMetaFromId: vi.fn(), scanCachedModels: vi.fn()}))
const settle = async () => {for (let i = 0; i < 20; i++) {await Promise.resolve()}}
const meta = (id: number): PackMeta => ({toneId: id, title: `Pack ${id}`, updatedAt: "", models: [
    {id, name: `Model ${id}`, size: "standard", model_url: ""}, {id: id + 10, name: "Next", size: "lite", model_url: ""}
]})
const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(graph)
    const {box, a, b} = editing.modify(() => {
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const a = NeuralAmpModelBox.create(graph, UUID.generate(), box => {box.packId.setValue("1"); box.label.setValue("Model 1")})
        const b = NeuralAmpModelBox.create(graph, UUID.generate(), box => {box.packId.setValue("2"); box.label.setValue("Model 2")})
        const box = NeuralAmpDeviceBox.create(graph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.model.refer(a)})
        for (const target of [a, b]) {NeuralAmpDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(unit.audioEffects); box.model.refer(target)
        })}
        return {box, a, b}
    }).unwrap()
    const adapter = {box, modelField: box.model, namedParameter: {}, monoField: box.mono, getModelJson: () => ""} as unknown as NeuralAmpDeviceBoxAdapter
    const project = {boxGraph: graph, editing, engine: {sampleRate: 44100}}
    const service = {project, optProject: Option.wrap(project)} as unknown as StudioService
    const lifecycle = new Terminator()
    const ui = NeuralAmpDeviceEditor({lifecycle, service, adapter, deviceHost: {} as DeviceHost}) as HTMLElement
    const root = vi.mocked(MenuButton).mock.calls.at(-1)![0].root
    const menu = () => root.collectChildren()
    return {graph, editing, box, a, b, lifecycle, ui, menu,
        select: (target: NeuralAmpModelBox) => editing.modify(() => box.model.refer(target))}
}
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
it("ignores old metadata after a newer pack and after editor disposal", async () => {
    const a = Promise.withResolvers<PackMeta | null>(), b = Promise.withResolvers<PackMeta | null>()
    vi.mocked(readPackMetaFromId).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    vi.mocked(scanCachedModels).mockResolvedValue(new Set([2]))
    const f = fixture(); f.select(f.b); b.resolve(meta(2)); await settle()
    expect(f.ui.querySelector(".pack-name")?.textContent).toBe("Pack 2")
    a.resolve(meta(1)); await settle()
    expect(f.ui.querySelector(".pack-name")?.textContent).toBe("Pack 2")
    const retired = Promise.withResolvers<PackMeta | null>()
    vi.mocked(readPackMetaFromId).mockReturnValueOnce(retired.promise)
    f.select(f.a); f.lifecycle.terminate(); retired.resolve(meta(1)); await settle()
    expect(scanCachedModels).toHaveBeenCalledTimes(1)
})
it("keeps cache badges bound to the current pack when old scans finish last", async () => {
    const a = Promise.withResolvers<ReadonlySet<number>>()
    vi.mocked(readPackMetaFromId).mockResolvedValueOnce(meta(1)).mockResolvedValueOnce(meta(2))
    vi.mocked(scanCachedModels).mockReturnValueOnce(a.promise).mockResolvedValueOnce(new Set([2]))
    const f = fixture(); await settle(); f.select(f.b); await settle()
    a.resolve(new Set([1])); await settle()
    const model = f.menu()[0]
    if (model.data.type !== "default") {throw new Error("Expected model menu item")}
    expect(model.data.label).toBe("Model 2")
    expect(model.data.icon).toBe(IconSymbol.Box)
    f.lifecycle.terminate()
})
it("aborts switches on retirement and observes late non-abort failures", async () => {
    vi.mocked(readPackMetaFromId).mockResolvedValue(meta(1))
    vi.mocked(scanCachedModels).mockResolvedValue(new Set())
    const pending = Promise.withResolvers<void>()
    vi.mocked(NamTone3000.loadModelFromPack).mockReturnValueOnce(pending.promise)
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const f = fixture(); await settle(); f.menu()[1].trigger(); await settle()
    const signal = vi.mocked(NamTone3000.loadModelFromPack).mock.calls[0][7]!
    f.lifecycle.terminate()
    const aborted = signal.aborted
    pending.reject(new Error("late retired failure")); await settle()
    expect(aborted).toBe(true)
    expect(errors).not.toHaveBeenCalled()
})
it("does not mark a newer external selection failed", async () => {
    vi.mocked(readPackMetaFromId).mockImplementation(async id => meta(Number(id)))
    vi.mocked(scanCachedModels).mockResolvedValue(new Set())
    const pending = Promise.withResolvers<void>()
    vi.mocked(NamTone3000.loadModelFromPack).mockReturnValueOnce(pending.promise)
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const f = fixture(); await settle(); f.menu()[1].trigger(); await settle()
    f.select(f.b); await settle()
    pending.reject(new Error("late old failure")); await settle()
    expect(errors).not.toHaveBeenCalled()
    expect(f.ui.textContent).not.toContain("URLs expired")
    f.lifecycle.terminate()
})

it("observes obsolete metadata failures without clearing the newer pack", async () => {
    const old = Promise.withResolvers<PackMeta | null>()
    vi.mocked(readPackMetaFromId).mockReturnValueOnce(old.promise).mockResolvedValueOnce(meta(2))
    vi.mocked(scanCachedModels).mockResolvedValue(new Set([2]))
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {})
    const f = fixture(); f.select(f.b); await settle()
    old.reject(new Error("obsolete metadata")); await settle()
    expect(f.ui.querySelector(".pack-name")?.textContent).toBe("Pack 2")
    expect(warnings).not.toHaveBeenCalled()
    f.lifecycle.terminate()
})
