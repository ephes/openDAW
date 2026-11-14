// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"
import {Shortcut, ShortcutContext, ShortcutManager} from "./shortcut-manager"

const manager = ShortcutManager.get()
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks()})

const key = (target: EventTarget, code: string, isComposing = false): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {key: code, code, bubbles: true, composed: true, cancelable: true, isComposing})
    const handle = (event: Event): void => manager.handleEvent(event as KeyboardEvent)
    window.addEventListener("keydown", handle)
    try {target.dispatchEvent(event)} finally {window.removeEventListener("keydown", handle)}
    return event
}

describe("shortcut ownership", () => {
    it("unsubscribes only its own entry even when terminated twice", () => {
        const context = new ShortcutContext(() => true, "test", 0)
        const a = context.register(Shortcut.of("KeyA"), vi.fn())
        const b = context.register(Shortcut.of("KeyB"), vi.fn())
        a.terminate()
        a.terminate()
        expect(context.entries.map(entry => entry.shortcut.code)).toEqual(["KeyB"])
        context.terminate()
        expect(context.entries).toEqual([])
        b.terminate()
        expect(context.entries).toEqual([])
    })

    it.each(["Delete", "Space"])("leaves composing %s to native editing, even for opt-in bindings", code => {
        const context = manager.createContext(() => true, "composition", 100)
        const consume = vi.fn()
        try {
            context.register(Shortcut.of(code), consume, {activeInTextField: true})
            expect(key(document.body, code, true).defaultPrevented).toBe(false)
            expect(consume).not.toHaveBeenCalled()
            expect(Shortcut.of(code).matches(new KeyboardEvent("keydown", {key: code, code, isComposing: true}))).toBe(false)
            expect(Shortcut.fromEvent(new KeyboardEvent("keydown", {key: "a", code: "KeyA", isComposing: true})).isEmpty()).toBe(true)
            expect(key(document.body, code).defaultPrevented).toBe(true)
            expect(consume).toHaveBeenCalledTimes(1)
        } finally {context.terminate()}
    })

    it("uses inherited editable state and the composed event origin", () => {
        const context = manager.createContext(() => true, "editing", 100)
        const consume = vi.fn(), optedIn = vi.fn()
        const editable = document.createElement("div")
        editable.contentEditable = "true"
        const child = editable.appendChild(document.createElement("span"))
        // jsdom lacks inherited isContentEditable; the browser smoke test checks
        // real inheritance and contenteditable=false without this fixture shim.
        Object.defineProperty(child, "isContentEditable", {value: true})
        document.body.append(editable)
        const host = document.body.appendChild(document.createElement("div"))
        const input = host.attachShadow({mode: "open"}).appendChild(document.createElement("input"))
        try {
            context.register(Shortcut.of("Delete"), consume)
            context.register(Shortcut.of("Space"), optedIn, {activeInTextField: true})
            expect(key(child, "Delete").defaultPrevented).toBe(false)
            expect(key(input, "Delete").defaultPrevented).toBe(false)
            expect(consume).not.toHaveBeenCalled()
            expect(key(child, "Space").defaultPrevented).toBe(true)
            expect(optedIn).toHaveBeenCalledTimes(1)
            expect(key(document.body, "Delete").defaultPrevented).toBe(true)
            expect(consume).toHaveBeenCalledTimes(1)
        } finally {context.terminate()}
    })

    it("allows normal shortcuts in an explicitly noneditable region", () => {
        const context = manager.createContext(() => true, "noneditable", 100)
        const consume = vi.fn()
        const target = document.body.appendChild(document.createElement("div"))
        target.setAttribute("contenteditable", "false")
        try {
            context.register(Shortcut.of("Delete"), consume)
            expect(key(target, "Delete").defaultPrevented).toBe(true)
            expect(consume).toHaveBeenCalledTimes(1)
        } finally {context.terminate()}
    })
})
