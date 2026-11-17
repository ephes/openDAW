import {describe, expect, it, vi} from "vitest"
import {DragAndDrop} from "./DragAndDrop"
import {AnyDragData} from "./AnyDragData"

const data = {type: "synthetic"} as unknown as AnyDragData
const drag = (element: HTMLElement, type: string, setDragImage: () => void = vi.fn()) => {
    element.dispatchEvent(Object.assign(new Event(type, {cancelable: true}), {
        dataTransfer: {setData: vi.fn(), setDragImage, types: [], effectAllowed: ""}
    }))
}
const payload = () => {
    const target = document.createElement("div"), drop = vi.fn()
    const owner = DragAndDrop.installTarget(target, {drag: () => true, drop, enter() {}, leave() {}})
    drag(target, "drop"); owner.terminate()
    return drop.mock.calls[0]?.[1]
}
const source = (provider = () => data, image = () => document.createElement("span")) => {
    const element = document.createElement("div")
    const ghost = document.createElement("span")
    const owner = DragAndDrop.installSource(element, provider, undefined, () => {image(); return ghost})
    return {element, ghost, owner}
}
describe("drag source ownership", () => {
    it("clears payload, ghost and class on retirement", () => {
        const a = source(); drag(a.element, "dragstart")
        expect(a.ghost.isConnected).toBe(true)
        a.owner.terminate(); a.owner.terminate()
        expect(a.element.classList.contains("dragging")).toBe(false)
        expect(a.ghost.isConnected).toBe(false)
        expect(payload()).toBeUndefined()
    })
    it("old source retirement cannot clear the latest payload", () => {
        const a = source(), b = source()
        drag(a.element, "dragstart"); drag(b.element, "dragstart")
        a.owner.terminate()
        expect(a.ghost.isConnected).toBe(false)
        expect(b.ghost.isConnected).toBe(true)
        expect(payload()).toBe(data)
        b.owner.terminate()
    })
    it.each(["provider", "image", "setDragImage"])("cleans failed %s setup", step => {
        const fail = () => {throw new Error("injected")}
        const a = source(step === "provider" ? fail : () => data, step === "image" ? fail : undefined)
        const onError = (event: ErrorEvent) => event.preventDefault()
        window.addEventListener("error", onError)
        try {drag(a.element, "dragstart", step === "setDragImage" ? fail : vi.fn())}
        finally {window.removeEventListener("error", onError)}
        expect(a.element.classList.contains("dragging")).toBe(false)
        expect(a.ghost.isConnected).toBe(false)
        expect(payload()).toBeUndefined()
        a.owner.terminate()
    })
})
