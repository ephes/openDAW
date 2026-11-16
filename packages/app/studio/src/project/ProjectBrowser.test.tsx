import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, RuntimeSignal, Terminator, UUID} from "@opendaw/lib-std"
import {ContextMenu, ProjectMeta, ProjectSignals, ProjectStorage} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"
import {ProjectBrowser} from "./ProjectBrowser"
const state = vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
    return {filter: undefined as DefaultObservableValue<string> | undefined, menus: 0}
})
vi.mock("./ProjectBrowser.sass?inline", () => ({default: "component {}"}))
vi.mock("@/ui/components/SearchInput", () => ({SearchInput: ({model}: {model: DefaultObservableValue<string>}) => {
    state.filter = model; return document.createElement("input")
}}))
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("span")}))
vi.mock("@/ui/spinner/ThreeDots", () => ({ThreeDots: () => document.createElement("span")}))
vi.mock("@/ui/components/dialogs", () => ({Dialogs: {approve: vi.fn(async () => true)}}))
const flush = async () => {for (let i = 0; i < 15; i++) {await Promise.resolve()}}
const projects = Array.from({length: 100}, (_, i) => ({uuid: UUID.generate(), meta: {...ProjectMeta.init(`Synthetic ${i}`)}}))
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks(); state.menus = 0})
it("retires row filter and menu subscriptions at refresh, removal and browser disposal", async () => {
    vi.spyOn(ProjectStorage, "listProjects").mockResolvedValue(projects)
    vi.spyOn(ContextMenu, "subscribe").mockImplementation(() => {
        state.menus++; return {terminate: () => {state.menus--}}
    })
    const lifecycle = new Terminator()
    const service = {deleteProject: vi.fn(async () => true)} as unknown as StudioService
    const ui = ProjectBrowser({service, lifecycle, select() {}}) as HTMLElement
    document.body.append(ui); await flush()
    for (let i = 0; i < 3; i++) {
        const retired = Array.from(ui.querySelectorAll(".labels")).map(element => vi.spyOn(element.parentElement!.classList, "toggle"))
        RuntimeSignal.dispatch(ProjectSignals.StorageUpdated); await flush()
        state.filter!.setValue(`filter ${i}`)
        expect(retired.every(spy => spy.mock.calls.length === 0)).toBe(true)
        expect(state.menus).toBe(100)
    }
    const row = ui.querySelector(".labels")!.parentElement!
    const toggle = vi.spyOn(row.classList, "toggle")
    ;(row.lastElementChild as HTMLElement).click(); await flush()
    state.filter!.setValue("last")
    expect(toggle).not.toHaveBeenCalled(); expect(state.menus).toBe(99)
    lifecycle.terminate(); expect(state.menus).toBe(0)
    const remaining = vi.spyOn(ui.querySelector(".labels")!.parentElement!.classList, "toggle")
    state.filter!.setValue("disposed"); expect(remaining).not.toHaveBeenCalled()
})
