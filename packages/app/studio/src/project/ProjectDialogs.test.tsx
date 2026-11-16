import {afterEach, expect, it, vi} from "vitest"
import {Lifecycle, UUID} from "@opendaw/lib-std"
import type {Project, ProjectMeta} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"
import {ProjectDialogs} from "./ProjectDialogs"

const state = vi.hoisted(() => {
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
    return {cleanup: vi.fn(), select: undefined as undefined | ((value: [UUID.Bytes, ProjectMeta]) => void)}
})
vi.mock("@/ui/surface/Surface", () => ({Surface: {get: () => ({flyout: document.body})}}))
vi.mock("@/ui/components/Dialog", () => ({Dialog: ({buttons}: {buttons: {text: string, onClick: (handler: {close: () => void}) => void}[]}, children: HTMLElement[]) => {
    const dialog = document.createElement("dialog")
    dialog.append(...children)
    for (const button of buttons) {
        const element = document.createElement("button"); element.textContent = button.text
        element.onclick = () => button.onClick({close: () => dialog.close()}); dialog.append(element)
    }
    return dialog
}}))
vi.mock("@/project/ProjectBrowser", () => ({ProjectBrowser: ({lifecycle, select}: {lifecycle: Lifecycle, select: typeof state.select}) => {
    lifecycle.own({terminate: state.cleanup}); state.select = select; return document.createElement("div")
}}))
vi.mock("@/service/ExportStemsConfigurator", () => ({ExportStemsConfigurator: ({lifecycle}: {lifecycle: Lifecycle}) => {
    lifecycle.own({terminate: state.cleanup}); return document.createElement("input")
}}))
const project = {rootBoxAdapter: {audioUnits: {adapters: () => []}}} as unknown as Project
const flush = async () => {for (let i = 0; i < 8; i++) {await Promise.resolve()}}
const start = (stems = false) => {
    let outcome = "pending"
    const pending = stems ? ProjectDialogs.showExportStemsDialog(project) : ProjectDialogs.showBrowseDialog({} as StudioService)
    pending.then(() => {outcome = "resolved"}, () => {outcome = "rejected"})
    return {pending, dialog: document.querySelector("dialog")!, outcome: () => outcome}
}
Object.assign(HTMLDialogElement.prototype, {showModal() {}, close(this: HTMLDialogElement) {this.dispatchEvent(new Event("close"))}})
afterEach(() => {document.body.replaceChildren(); vi.clearAllMocks(); vi.restoreAllMocks()})
it.each(["Cancel", "Enter", "Escape", "close", "select"])("settles browser %s once and releases its owner", async path => {
    const f = start()
    if (path === "Cancel") {f.dialog.querySelector("button")!.click()}
    if (path === "Enter") {f.dialog.dispatchEvent(new KeyboardEvent("keydown", {code: "Enter"}))}
    if (path === "Escape") {f.dialog.dispatchEvent(new Event("cancel")); f.dialog.close()}
    if (path === "close") {f.dialog.close()}
    if (path === "select") {state.select!([UUID.generate(), {} as ProjectMeta])}
    await flush(); expect(f.outcome()).toBe(path === "select" ? "resolved" : "rejected")
    f.dialog.close(); await flush(); expect(state.cleanup).toHaveBeenCalledTimes(1)
})
it("gives Enter the same stem export outcome, ignoring composing Enter", async () => {
    const f = start(true)
    f.dialog.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, code: "Enter", isComposing: true}))
    await flush(); expect(f.outcome()).toBe("pending")
    f.dialog.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, code: "Enter", cancelable: true}))
    await flush(); expect(f.outcome()).toBe("resolved"); expect(state.cleanup).toHaveBeenCalledTimes(1)
})
it.each([false, true])("cleans up showModal failure (stems=%s)", async stems => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(() => {throw new Error("setup")})
    const f = start(stems); await expect(f.pending).rejects.toThrow("setup")
    expect(state.cleanup).toHaveBeenCalledTimes(1)
})
it.each(["Cancel", "Escape", "close", "Export"])("settles stem %s", async path => {
    const f = start(true)
    if (path === "Escape") {f.dialog.dispatchEvent(new Event("cancel")); f.dialog.close()}
    else if (path === "close") {f.dialog.close()}
    else {Array.from(f.dialog.querySelectorAll("button")).find(button => button.textContent === path)!.click()}
    await flush(); expect(f.outcome()).toBe(path === "Export" ? "resolved" : "rejected")
    expect(state.cleanup).toHaveBeenCalledTimes(1)
})
