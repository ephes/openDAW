import {afterEach, describe, expect, it, vi} from "vitest"
import {Clipboard} from "@opendaw/lib-dom"
import {Option, Terminable} from "@opendaw/lib-std"
import {ClipboardEntry, ClipboardHandler, ClipboardManager} from "./ClipboardManager"
import {ContextMenu} from "./ContextMenu"
import {MenuItem} from "../menu/MenuItems"

vi.mock("./ContextMenu", () => ({ContextMenu: {subscribe: vi.fn(() => Terminable.Empty)}}))
vi.mock("../../StudioPreferences", () => ({StudioPreferences: {settings: {editing: {"show-clipboard-menu": true}}}}))

const MAX_BYTES = 8 * 1024 * 1024
const MAX_TEXT = 4 * Math.ceil(MAX_BYTES / 3) + 80
const client = {clientX: 0, clientY: 0}
const installs: Terminable[] = []
afterEach(() => {
    installs.splice(0).forEach(install => install.terminate())
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

const setup = async () => {
    const handler: ClipboardHandler<ClipboardEntry> = {
        canCopy: () => true, canCut: () => false, canPaste: () => true,
        copy: () => Option.wrap({type: "notes", data: new Uint8Array([1]).buffer}),
        cut: () => Option.None, paste: vi.fn()
    }
    vi.spyOn(Clipboard, "writeText").mockResolvedValue()
    const element = document.createElement("div")
    document.body.append(element)
    installs.push(ClipboardManager.install(element, handler))
    // Seed a valid fallback so refused envelopes cannot accidentally replay it.
    element.dispatchEvent(new Event("copy", {bubbles: true}))
    const collect = vi.mocked(ContextMenu.subscribe).mock.calls.at(-1)![1]
    return {handler, collect}
}

const pasteEvent = (text: string) => {
    const event = new Event("paste", {bubbles: true, cancelable: true})
    Object.defineProperty(event, "clipboardData", {value: {getData: () => text}})
    document.dispatchEvent(event)
}

const menu = async (collect: Parameters<typeof ContextMenu.subscribe>[1]) => {
    const items: MenuItem[] = []
    const collector: ContextMenu.Collector = {client, addItems: (...added) => {items.push(...added); return collector}}
    await collect(collector)
    return items[2]
}

describe("clipboard text admission", () => {
    it.each(["event", "menu"])("rejects oversized encoded text before atob in the %s path", async path => {
        const {handler, collect} = await setup()
        const text = `OPENDAW:2:notes:${"A".repeat(MAX_TEXT)}`
        const atobSpy = vi.spyOn(globalThis, "atob").mockReturnValue("")
        vi.spyOn(Clipboard, "readText").mockResolvedValue(text)
        if (path === "event") {pasteEvent(text)} else {
            const item = await menu(collect)
            expect(item.selectable).toBe(false)
            item.trigger()
            await Promise.resolve()
        }
        expect(atobSpy).not.toHaveBeenCalled()
        expect(handler.paste).not.toHaveBeenCalled()
    })

    it("rejects a decoded size over budget before atob", async () => {
        const {handler} = await setup()
        // Same encoded length as the boundary payload, one more decoded byte.
        const text = `OPENDAW:2:notes:${"A".repeat(4 * Math.ceil(MAX_BYTES / 3))}`
        const atobSpy = vi.spyOn(globalThis, "atob").mockReturnValue("")
        pasteEvent(text)
        expect(atobSpy).not.toHaveBeenCalled()
        expect(handler.paste).not.toHaveBeenCalled()
    })

    it("admits the inclusive decoded boundary", async () => {
        const {handler} = await setup()
        const text = `OPENDAW:2:notes:${"A".repeat(4 * Math.ceil(MAX_BYTES / 3) - 1)}=`
        vi.spyOn(globalThis, "atob").mockReturnValue("\0".repeat(MAX_BYTES))
        pasteEvent(text)
        expect(handler.paste).toHaveBeenCalledOnce()
        expect(vi.mocked(handler.paste).mock.calls[0][0].data.byteLength).toBe(MAX_BYTES)
    })
})

describe("paste handler errors", () => {
    const pasteProcedure = async (collect: Parameters<typeof ContextMenu.subscribe>[1]) => {
        const trigger = vi.spyOn(MenuItem.prototype, "setTriggerProcedure")
        const item = await menu(collect)
        return {run: () => trigger.mock.calls.at(-1)![0](item)}
    }

    it("propagates a handler error once without replaying fallback", async () => {
        const {handler, collect} = await setup()
        vi.spyOn(Clipboard, "readText").mockResolvedValue("OPENDAW:2:notes:Ag==")
        const error = new Error("synthetic handler failure")
        vi.mocked(handler.paste).mockImplementationOnce(() => {throw error})
        const {run} = await pasteProcedure(collect)
        await expect(run()).rejects.toBe(error)
        expect(handler.paste).toHaveBeenCalledOnce()
        expect(new Uint8Array(vi.mocked(handler.paste).mock.calls[0][0].data)).toEqual(new Uint8Array([2]))
    })

    it("still pastes fallback once when clipboard permission is denied", async () => {
        const {handler, collect} = await setup()
        vi.spyOn(Clipboard, "readText").mockRejectedValue(new Error("synthetic denied read"))
        const {run} = await pasteProcedure(collect)
        await run()
        expect(handler.paste).toHaveBeenCalledOnce()
        expect(new Uint8Array(vi.mocked(handler.paste).mock.calls[0][0].data)).toEqual(new Uint8Array([1]))
    })
})
