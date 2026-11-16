import {afterEach, expect, it, vi} from "vitest"
import {Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {ProjectMeta, ProjectProfile, ProjectStorage} from "@opendaw/studio-core"
import {StudioService} from "./StudioService"
vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("@/service/StudioMenu", () => ({populateStudioMenu: () => ({})}))
vi.mock("@/ui/workspace/PanelContents.tsx", () => ({PanelContents: class {}}))
vi.mock("@/ui/workspace/PanelFactory.tsx", () => ({createPanelFactory() {}}))
vi.mock("@/ui/spotlight/SpotlightDataSupplier.ts", () => ({SpotlightDataSupplier: class {registerAction() {}}}))
vi.mock("@/ui/components/dialogs.tsx", () => ({Dialogs: {}}))
vi.mock("@/service/SamplePlayback", () => ({SamplePlayback: class {}}))
vi.mock("@/project/ProjectDialogs", () => ({ProjectDialogs: {}}))
vi.mock("@/ui/browse/PresetService", () => ({PresetService: class {}}))
vi.mock("@/ui/surface/Surface", () => ({Surface: {}}))
vi.mock("@/ui/software-midi/SoftwareMIDIPanel", () => ({SoftwareMIDIPanel: class {}}))
vi.mock("@/service/Mixdowns", () => ({Mixdowns: {}}))
vi.mock("@/ui/shadertoy/ShadertoyState", () => ({ShadertoyState: class {}}))
vi.mock("@/ui/code-editor/CodeEditorState", () => ({CodeEditorState: class {}}))
vi.mock("@opendaw/lib-jsx", () => ({RouteLocation: {get: () => ({navigateTo() {}, path: "/"})}}))
vi.mock("@opendaw/lib-dom", async original => {
    const module = await original<typeof import("@opendaw/lib-dom")>()
    return {...module, ConsoleCommands: {exportAccessor() {}, exportMethod() {}}, Browser: {...module.Browser, isLocalHost: () => true}}
})
vi.mock("@opendaw/studio-core", async original => ({...await original<object>(),
    Recovery: class {async restoreProfile() {return Option.None}}, EngineFacade: class {},
    SampleService: class {subscribe() {}}, SoundfontService: class {subscribe() {}},
    StudioPreferences: {catchupAndSubscribe() {}}}))
vi.mock("./ProjectProfileService", () => ({ProjectProfileService: class {
    value = Option.None as Option<ProjectProfile>
    getValue() {return this.value}
    setValue(value: Option<ProjectProfile>) {this.value = value}
    catchupAndSubscribe() {}
}}))
const fixture = () => {
    const service = Reflect.construct(StudioService, Array.from({length: 9}, () => ({}))) as StudioService
    const uuid = UUID.generate(), meta = ProjectMeta.init("Synthetic")
    const profile = {uuid, meta, project: {editing: {hasNoChanges: () => false}}} as unknown as ProjectProfile
    service.projectProfileService.setValue(Option.wrap(profile))
    const deleted = vi.spyOn(ProjectStorage, "deleteProject").mockResolvedValue()
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
    return {service, uuid, meta, profile, deleted}
}
afterEach(() => vi.restoreAllMocks())
it("reports failed storage deletion and permits a successful retry", async () => {
    const f = fixture(); f.service.projectProfileService.setValue(Option.None)
    f.deleted.mockRejectedValueOnce(new Error("synthetic storage refusal"))
    expect(await f.service.deleteProject(f.uuid, f.meta)).toBe(false)
    expect(RuntimeNotifier.info).toHaveBeenCalledTimes(1)
    expect(await f.service.deleteProject(f.uuid, f.meta)).toBe(true)
    expect(f.deleted).toHaveBeenCalledTimes(2)
})
it("does not delete an active project when closing is declined", async () => {
    const f = fixture(); vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
    const outcome = await f.service.deleteProject(f.uuid, f.meta)
    expect(f.deleted).not.toHaveBeenCalled()
    expect(outcome).toBe(false)
    expect(f.service.profile).toBe(f.profile)
})
it("closes the approved identity before deletion", async () => {
    const f = fixture(); vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(true)
    f.deleted.mockImplementation(async () => {expect(f.service.hasProfile).toBe(false)})
    expect(await f.service.deleteProject(f.uuid, f.meta)).toBe(true)
    expect(f.deleted).toHaveBeenCalledOnce()
})
it("preserves a replacement profile while close approval is pending", async () => {
    const f = fixture(), approval = Promise.withResolvers<boolean>()
    vi.spyOn(RuntimeNotifier, "approve").mockReturnValue(approval.promise)
    const pending = f.service.deleteProject(f.uuid, f.meta)
    const next = {...f.profile, uuid: UUID.generate()} as ProjectProfile
    f.service.projectProfileService.setValue(Option.wrap(next)); approval.resolve(true)
    const outcome = await pending
    expect(f.service.profile).toBe(next); expect(f.deleted).not.toHaveBeenCalled()
    expect(outcome).toBe(false)
})
