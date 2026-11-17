import {afterEach, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {Browser, ShortcutManager} from "@opendaw/lib-dom"
import {NotePadPanel} from "./NotePadPanel"
import type {StudioService} from "@/service/StudioService"

vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "synthetic-style"}}
})

const disposals: Terminator[] = []
Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true, get() {return this.textContent ?? ""}
})
afterEach(() => {disposals.splice(0).forEach(owner => owner.terminate()); document.body.replaceChildren(); vi.restoreAllMocks()})
const mount = (initial: string) => {
    const lifecycle = new Terminator()
    disposals.push(lifecycle)
    let saved = initial
    const profile = {meta: {notepad: initial}, updateMetaData: (_: string, text: string) => {saved = text}}
    const panel = NotePadPanel({lifecycle, service: {profile} as unknown as StudioService})
    document.body.append(panel)
    const content = panel.querySelector<HTMLElement>(".content")!
    const mode = (checked: boolean) => {
        const input = panel.querySelector<HTMLInputElement>("input")!
        input.checked = checked
        input.dispatchEvent(new Event("input"))
    }
    const save = () => ShortcutManager.get().handleEvent(new KeyboardEvent("keydown", {code: "KeyS", key: "s", ctrlKey: !Browser.isMacOS(), metaKey: Browser.isMacOS()}))
    return {lifecycle, content, mode, save, read: () => saved}
}
const markdown = "# Heading\n\n[link](/manuals/topic?mode=x#section)\n\n```ts\nconst value = 1\n```\n"

it("retains exact Markdown across repeated preview saves and reopening", () => {
    const note = mount(markdown)
    expect(note.content.textContent).not.toBe(markdown)
    note.save(); note.save()
    expect(note.read()).toBe(markdown)
    note.lifecycle.terminate()
    const reopened = mount(note.read())
    reopened.save()
    expect(reopened.read()).toBe(markdown)
})

it.each(["mode", "blur", "teardown"])("commits editable text before %s replaces or retires the DOM", exit => {
    const note = mount(markdown)
    note.mode(true)
    const edited = markdown + "\nNew text"
    note.content.textContent = edited
    if (exit === "mode") {note.mode(false)}
    if (exit === "blur") {note.content.dispatchEvent(new Event("blur"))}
    if (exit === "teardown") {note.lifecycle.terminate()}
    expect(note.read()).toBe(edited)
    note.save(); note.save()
    expect(note.read()).toBe(edited)
})
