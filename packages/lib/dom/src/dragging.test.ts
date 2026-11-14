// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Option, Terminable} from "@opendaw/lib-std"
import {Dragging} from "./dragging"
import {AnimationFrame} from "./frames"

const pointer = (target: EventTarget, type: string, pointerId = 1): void => {
    const event = new MouseEvent(type, {bubbles: true, cancelable: true, buttons: 1, clientX: 100, clientY: 100})
    Object.defineProperties(event, {pointerId: {value: pointerId}, isPrimary: {value: true}})
    target.dispatchEvent(event)
}

let target: HTMLDivElement
let attachment: Terminable | undefined
let errors: unknown[]
const onError = (event: ErrorEvent): void => {errors.push(event.error); event.preventDefault()}

beforeEach(() => {
    target = document.createElement("div")
    document.body.append(target)
    let capture = false
    target.setPointerCapture = vi.fn(() => {capture = true})
    target.hasPointerCapture = vi.fn(() => capture)
    target.releasePointerCapture = vi.fn(() => {capture = false})
    errors = []
    window.addEventListener("error", onError)
})
afterEach(() => {
    attachment?.terminate()
    attachment = undefined
    AnimationFrame.terminate()
    window.removeEventListener("error", onError)
    target.remove()
    Dragging.usePointerLock = false
    vi.restoreAllMocks()
})

describe("drag settlement", () => {
    it.each(["approve", "cancel", "finally"] as const)("unwinds when %s throws and permits a fresh drag", hook => {
        const failure = new Error(hook)
        const process = {update: vi.fn(), approve: vi.fn(), cancel: vi.fn(), finally: vi.fn()}
        process[hook].mockImplementationOnce(() => {throw failure})
        attachment = Dragging.attach(target, () => Option.wrap(process), {permanentUpdates: true})
        pointer(target, "pointerdown")
        pointer(target, hook === "cancel" ? "pointercancel" : "pointerup")
        expect(errors).toEqual([failure])
        expect(process.finally).toHaveBeenCalledTimes(1)
        pointer(target, "pointermove")
        pointer(target, "pointerup")
        window.dispatchEvent(new KeyboardEvent("keyup", {key: "Shift"}))
        expect(process.update).not.toHaveBeenCalled()
        expect(process.approve).toHaveBeenCalledTimes(hook === "cancel" ? 0 : 1)
        expect(target.hasPointerCapture(1)).toBe(false)
        pointer(target, "pointerdown", 2)
        pointer(target, "pointerup", 2)
        expect(process.finally).toHaveBeenCalledTimes(2)
    })

    it("preserves the terminal error when the final hook also fails", () => {
        const first = new Error("approve")
        attachment = Dragging.attach(target, () => Option.wrap({
            update: vi.fn(), approve: () => {throw first}, finally: () => {throw new Error("finally")}
        }))
        pointer(target, "pointerdown")
        pointer(target, "pointerup")
        expect(errors).toEqual([first])
        expect(target.hasPointerCapture(1)).toBe(false)
    })

    it("cancels provisional edits exactly once when the owner is disposed", () => {
        let edit = false
        const process = {update: () => {edit = true}, cancel: vi.fn(() => {edit = false}), approve: vi.fn(), finally: vi.fn()}
        attachment = Dragging.attach(target, () => Option.wrap(process), {immediate: true})
        pointer(target, "pointerdown")
        expect(edit).toBe(true)
        attachment.terminate()
        attachment.terminate()
        pointer(target, "pointerup")
        expect(edit).toBe(false)
        expect(process.cancel).toHaveBeenCalledTimes(1)
        expect(process.finally).toHaveBeenCalledTimes(1)
        expect(process.approve).not.toHaveBeenCalled()
        expect(target.hasPointerCapture(1)).toBe(false)
    })
})

describe("drag acquisition", () => {
    it.each(["aborted", "capture", "update"] as const)("compensates failed %s setup", mode => {
        const controller = new AbortController()
        if (mode === "aborted") {controller.abort()}
        const failure = new Error(mode)
        if (mode === "capture") {target.setPointerCapture = vi.fn(() => {throw failure})}
        const process = {
            update: vi.fn(() => {if (mode === "update") {throw failure}}),
            cancel: vi.fn(), approve: vi.fn(), finally: vi.fn(), abortSignal: controller.signal
        }
        attachment = Dragging.attach(target, () => Option.wrap(process), {immediate: true, permanentUpdates: true})
        pointer(target, "pointerdown")
        expect(process.cancel).toHaveBeenCalledTimes(1)
        expect(process.finally).toHaveBeenCalledTimes(1)
        expect(process.approve).not.toHaveBeenCalled()
        process.update.mockClear()
        pointer(target, "pointermove")
        pointer(target, "pointerup")
        window.dispatchEvent(new KeyboardEvent("keyup", {key: "Shift"}))
        expect(process.update).not.toHaveBeenCalled()
        expect(target.hasPointerCapture(1)).toBe(false)
        if (mode === "update") {expect(errors).toEqual([failure])}
    })

    it.each(["pointerup", "pointercancel", "dispose", "replacement"])("retires a deferred lock after %s", async end => {
        // Exported preference is mutable in the studio too.
        Dragging.usePointerLock = true
        let locked: Element | null = null
        Object.defineProperty(document, "pointerLockElement", {configurable: true, get: () => locked})
        document.exitPointerLock = vi.fn(() => {locked = null})
        const resolvers: Array<() => void> = []
        target.requestPointerLock = vi.fn(() => new Promise<void>(resolve => {
            resolvers.push(() => {locked = target; resolve()})
        }))
        const process = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
        attachment = Dragging.attach(target, () => Option.wrap(process), {pointerLock: true, pointerLockThreshold: 200})
        pointer(target, "pointerdown")
        pointer(target, "pointermove")
        pointer(target, "pointermove")
        expect(target.requestPointerLock).toHaveBeenCalledTimes(1)
        if (end === "dispose") {attachment.terminate()}
        else if (end !== "replacement") {pointer(target, end)}
        if (end === "replacement") {
            pointer(target, "pointerdown", 2)
            pointer(target, "pointermove", 2)
            expect(target.requestPointerLock).toHaveBeenCalledTimes(1)
        }
        resolvers[0]()
        await Promise.resolve()
        expect(locked).toBe(null)
        expect(document.exitPointerLock).toHaveBeenCalledTimes(1)
        if (end === "replacement") {
            pointer(target, "pointermove", 2)
            expect(target.requestPointerLock).toHaveBeenCalledTimes(2)
            resolvers[1]()
            await Promise.resolve()
            expect(locked).toBe(target)
            pointer(target, "pointerup", 2)
            expect(locked).toBe(null)
            expect(document.exitPointerLock).toHaveBeenCalledTimes(2)
        }
        Dragging.usePointerLock = false
    })
})
