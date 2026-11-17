import {beforeEach, expect, it, vi} from "vitest"
import {Option, Terminator} from "@opendaw/lib-std"
import {PanelContent} from "./PanelContent"
import {PanelState} from "./PanelState"
import {PanelType} from "./PanelType"

vi.hoisted(() => {
    document.adoptedStyleSheets = []
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
})
const windows = vi.hoisted(() => ({active: false, ground: document.createElement("div"), close: vi.fn(),
    own: vi.fn(), unload: () => {}}))
vi.mock("../surface/Surface", async () => {
    const {Option} = await import("@opendaw/lib-std")
    return {Surface: {getById: () => windows.active ? Option.wrap(windows) : Option.None,
        get: () => ({new: () => {windows.active = true; return Option.wrap(windows)}})}}
})
vi.mock("@/ui/components/dialogs.tsx", () => ({Dialogs: {info: vi.fn()}}))
beforeEach(() => {
    windows.active = false
    windows.ground.replaceChildren()
    windows.close.mockClear()
    const lifecycle = new Terminator()
    windows.own.mockImplementation(resource => lifecycle.own(resource))
    windows.unload = () => {windows.active = false; lifecycle.terminate()}
    windows.close.mockImplementation(() => windows.unload())
})
const state = () => ({isMinimized: false, minimizable: true, popoutable: true, name: "Synthetic"}) as PanelState
const listener = () => ({onEmbed: vi.fn(), onPopout: vi.fn(), onMinimized: vi.fn()})

it("unwinds factory resources and binding reservation before retry", () => {
    const cleanup = vi.fn()
    let fail = true
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        if (fail) {throw new Error("synthetic factory failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const container = document.createElement("div")
    expect(() => content.bind(state(), container, listener())).toThrow("synthetic factory failure")
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(content.panelState).toBe(Option.None)
    fail = false
    const handle = content.bind(state(), container, listener())
    expect(container.children).toHaveLength(1)
    handle.terminate()
    expect(cleanup).toHaveBeenCalledTimes(2)
})

it("closes failed popout candidates and rebuilds the embedded owner", () => {
    const cleanup = vi.fn()
    let failures = 0
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        if (failures > 0) {failures--; throw new Error("synthetic reconstruction failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const panelState = state()
    const container = document.createElement("div")
    const panelListener = listener()
    const handle = content.bind(panelState, container, panelListener)
    const embedded = container.firstChild
    failures = 1
    expect(() => handle.togglePopout()).toThrow("synthetic reconstruction failure")
    expect(windows.active).toBe(false)
    expect(container.children).toHaveLength(1)
    expect(container.firstChild).not.toBe(embedded)
    expect(panelState.isMinimized).toBe(false)
    expect(cleanup).toHaveBeenCalledTimes(2)
    handle.togglePopout()
    expect(handle.isPopout()).toBe(true)
    handle.togglePopout()
    expect(handle.isPopout()).toBe(false)
    handle.terminate()
    expect(cleanup).toHaveBeenCalledTimes(5)
    expect(panelListener.onMinimized).not.toHaveBeenCalled()
})

it("minimizes when neither the popout nor the embedded owner can be rebuilt", () => {
    const cleanup = vi.fn()
    let fail = false
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        if (fail) {throw new Error("persistent failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const panelState = state()
    const container = document.createElement("div")
    const panelListener = listener()
    const handle = content.bind(panelState, container, panelListener)
    fail = true
    expect(() => handle.togglePopout()).toThrow("persistent failure")
    expect(windows.active).toBe(false)
    expect(container.children).toHaveLength(0)
    expect(panelState.isMinimized).toBe(true)
    expect(panelListener.onMinimized).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(3)
    fail = false
    handle.toggleMinimize()
    expect(container.children).toHaveLength(1)
    handle.terminate()
    expect(cleanup).toHaveBeenCalledTimes(4)
})

it("keeps a failed popout candidate out of the embedded owner until its window unloads", () => {
    const cleanup = vi.fn()
    let failures = 0
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        if (failures > 0) {failures--; throw new Error("synthetic reconstruction failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const panelState = state()
    const container = document.createElement("div")
    const panelListener = listener()
    const handle = content.bind(panelState, container, panelListener)
    windows.close.mockImplementation(() => {})
    failures = 1
    expect(() => handle.togglePopout()).toThrow("synthetic reconstruction failure")
    expect(windows.close).toHaveBeenCalledTimes(1)
    expect(container.children).toHaveLength(0)
    expect(cleanup).toHaveBeenCalledTimes(2)
    windows.unload()
    expect(handle.isPopout()).toBe(false)
    expect(container.children).toHaveLength(1)
    expect(panelState.isMinimized).toBe(false)
    expect(panelListener.onEmbed).toHaveBeenCalledTimes(2)
    handle.terminate()
    expect(container.children).toHaveLength(0)
    expect(cleanup).toHaveBeenCalledTimes(3)
})

it("retires the embedded owner before the popout factory reads its flushed state", () => {
    let stored = "stale", pending = "fresh"
    const reads: Array<string> = []
    const content = new PanelContent({create: lifecycle => {
        reads.push(stored)
        lifecycle.own({terminate: () => {stored = pending}})
        return document.createElement("article")
    }}, PanelType.Notepad)
    const handle = content.bind(state(), document.createElement("div"), listener())
    handle.togglePopout()
    expect(reads).toEqual(["stale", "fresh"])
    pending = "popout"
    handle.togglePopout()
    expect(reads).toEqual(["stale", "fresh", "popout"])
    handle.terminate()
})

it("keeps failed embedded reconstruction minimized and retryable", () => {
    let fail = false
    const cleanup = vi.fn()
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        if (fail) {throw new Error("embed failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const panelState = state()
    const handle = content.bind(panelState, document.createElement("div"), listener())
    handle.toggleMinimize()
    fail = true
    expect(() => handle.toggleMinimize()).toThrow("embed failure")
    expect(panelState.isMinimized).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(2)
    fail = false
    handle.toggleMinimize()
    handle.terminate()
    expect(cleanup).toHaveBeenCalledTimes(3)
})

it("makes retired binding handles inert and termination idempotent", () => {
    const cleanup = vi.fn()
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        return document.createElement("article")
    }}, PanelType.Notepad)
    const retired = content.bind(state(), document.createElement("div"), listener())
    retired.terminate()
    const container = document.createElement("div")
    const current = content.bind(state(), container, listener())
    retired.toggleMinimize(); retired.togglePopout(); retired.terminate()
    expect(container.children).toHaveLength(1)
    expect(current.isPopout()).toBe(false)
    current.terminate(); current.terminate()
    expect(cleanup).toHaveBeenCalledTimes(2)
})

it("recovers a failed return from popout as a minimized, retryable panel", () => {
    let fail = false
    const cleanup = vi.fn()
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        if (fail) {throw new Error("return failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const panelState = state()
    const container = document.createElement("div")
    const handle = content.bind(panelState, container, listener())
    handle.togglePopout()
    fail = true
    expect(() => handle.togglePopout()).toThrow("return failure")
    expect(windows.active).toBe(false)
    expect(panelState.isMinimized).toBe(true)
    expect(container.children).toHaveLength(0)
    expect(cleanup).toHaveBeenCalledTimes(3)
    fail = false
    handle.toggleMinimize()
    expect(container.children).toHaveLength(1)
    handle.terminate()
    expect(cleanup).toHaveBeenCalledTimes(4)
})

it("keeps a live popout through a placeholder rebind and ignores its retired handle", () => {
    const cleanup = vi.fn()
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: cleanup})
        return document.createElement("article")
    }}, PanelType.Notepad)
    const first = content.bind(state(), document.createElement("div"), listener())
    first.togglePopout()
    first.terminate()
    const container = document.createElement("div")
    const second = content.bind(state(), container, listener())
    first.togglePopout(); first.toggleMinimize(); first.terminate()
    expect(second.isPopout()).toBe(true)
    expect(windows.active).toBe(true)
    second.togglePopout()
    expect(container.children).toHaveLength(1)
    second.terminate()
    expect(cleanup).toHaveBeenCalledTimes(3)
})
