import {GlobalShortcuts} from "@/ui/shortcuts/GlobalShortcuts"
import {NotePadPanel} from "@/ui/NotePadPanel"
import {renderMarkdown} from "@/ui/Markdown"
import {ShortcutManager, Events} from "@opendaw/lib-dom"
import {Terminator} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"

export const setupNotes = (initial: string) => {
    let saved = initial
    let lifecycle: Terminator
    let panel: Element
    const mount = () => {
        lifecycle = new Terminator()
        const service = {profile: {meta: {notepad: saved}, updateMetaData: (_: string, text: string) => {saved = text}}}
        panel = NotePadPanel({lifecycle, service: service as unknown as StudioService})
        document.body.replaceChildren(panel)
        lifecycle.own(Events.subscribe(window, "keydown", event => ShortcutManager.get().handleEvent(event)))
        lifecycle.own(ShortcutManager.get().global.register(GlobalShortcuts["project-save"].shortcut, () => {}, {activeInTextField: true}))
    }
    mount()
    return {
        read: () => saved,
        close: () => {lifecycle.terminate(); panel.remove()},
        reopen: () => {lifecycle.terminate(); panel.remove(); mount()}
    }
}

export const setupLinks = () => {
    const element = document.createElement("div")
    renderMarkdown(element, "[query](/manuals/topic?mode=x#section) [section](#section) [plain](/manuals/topic)")
    const section = document.createElement("div")
    section.id = "section"
    section.textContent = "Destination"
    section.style.marginTop = "2000px"
    document.body.replaceChildren(element, section)
    return (label: string, options: MouseEventInit = {}) => {
        const anchor = Array.from(element.querySelectorAll("a")).find(a => a.textContent === label)!
        const event = new PointerEvent("click", {bubbles: true, cancelable: true, ...options})
        // Observe the component handler without following the synthetic event's default action.
        anchor.onclick?.call(anchor, event)
        return event.defaultPrevented
    }
}
