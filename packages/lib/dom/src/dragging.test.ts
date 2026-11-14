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
let frameCallback: FrameRequestCallback
let frameTime = 0
const tick = (): void => {frameCallback(frameTime += 20)}
let errors: unknown[]
const onError = (event: ErrorEvent): void => {errors.push(event.error); event.preventDefault()}

beforeEach(() => {
    target = document.createElement("div")
    document.body.append(target)
    let capture = false
    target.setPointerCapture = vi.fn(() => {capture = true})
    target.hasPointerCapture = vi.fn(() => capture)
    target.releasePointerCapture = vi.fn(() => {capture = false})
    AnimationFrame.start({
        requestAnimationFrame: (callback: FrameRequestCallback): number => {frameCallback = callback; return 1},
        cancelAnimationFrame: vi.fn()
    } as unknown as WindowProxy)
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
        tick()
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
        tick()
        expect(process.update).not.toHaveBeenCalled()
        expect(target.hasPointerCapture(1)).toBe(false)
        if (mode === "update") {expect(errors).toEqual([failure])}
    })

    it.each(["before", "after"])("keeps a drag alive when the granted lock releases capture %s the promise settles", async order => {
        Dragging.usePointerLock = true
        try {
            let locked: Element | null = null
            Object.defineProperty(document, "pointerLockElement", {configurable: true, get: () => locked})
            document.exitPointerLock = vi.fn(() => {locked = null})
            let grant: () => void = () => {}
            target.requestPointerLock = vi.fn(() => new Promise<void>(resolve => {grant = () => {locked = target; resolve()}}))
            const process = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
            attachment = Dragging.attach(target, () => Option.wrap(process), {pointerLock: true, pointerLockThreshold: 200})
            pointer(target, "pointerdown")
            pointer(target, "pointermove")
            expect(target.requestPointerLock).toHaveBeenCalledTimes(1)
            const loseCapture = (): void => {
                (target.releasePointerCapture as (id: number) => void)(1)
                pointer(target, "lostpointercapture")
            }
            if (order === "before") {loseCapture()}
            grant()
            await Promise.resolve()
            if (order === "after") {loseCapture()}
            expect(process.cancel).not.toHaveBeenCalled()
            expect(locked).toBe(target)
            pointer(target, "pointermove")
            pointer(target, "pointerup")
            expect(process.approve).toHaveBeenCalledTimes(1)
            expect(process.cancel).not.toHaveBeenCalled()
            expect(locked).toBe(null)
        } finally {
            Dragging.usePointerLock = false
        }
    })

    it.each(["rejected", "not granted"])("cancels a drag whose capture went to a lock that was %s", async outcome => {
        Dragging.usePointerLock = true
        try {
            Object.defineProperty(document, "pointerLockElement", {configurable: true, get: () => null})
            let settle: () => void = () => {}
            target.requestPointerLock = vi.fn(() => new Promise<void>((resolve, reject) => {
                settle = outcome === "rejected" ? () => reject(new Error("denied")) : () => resolve()
            }))
            const process = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
            attachment = Dragging.attach(target, () => Option.wrap(process), {pointerLock: true, pointerLockThreshold: 200})
            pointer(target, "pointerdown")
            pointer(target, "pointermove")
            pointer(target, "lostpointercapture")
            expect(process.cancel).not.toHaveBeenCalled()
            settle()
            await Promise.resolve()
            await Promise.resolve()
            expect(process.cancel).toHaveBeenCalledTimes(1)
            expect(process.finally).toHaveBeenCalledTimes(1)
        } finally {
            Dragging.usePointerLock = false
        }
    })

    it("reports a throwing cancel hook after a rejected lock through reportError", async () => {
        Dragging.usePointerLock = true
        // Browsers provide window.reportError (it dispatches a window "error" event); jsdom 25 does not.
        const reported = vi.fn()
        Object.defineProperty(window, "reportError", {configurable: true, writable: true, value: reported})
        try {
            Object.defineProperty(document, "pointerLockElement", {configurable: true, get: () => null})
            let reject: () => void = () => {}
            target.requestPointerLock = vi.fn(() => new Promise<void>((_, fail) => {reject = () => fail(new Error("denied"))}))
            const failure = new Error("cancel hook failed")
            const process = {update: vi.fn(), cancel: vi.fn(() => {throw failure}), approve: vi.fn(), finally: vi.fn()}
            attachment = Dragging.attach(target, () => Option.wrap(process), {pointerLock: true, pointerLockThreshold: 200})
            pointer(target, "pointerdown")
            pointer(target, "pointermove")
            pointer(target, "lostpointercapture")
            reject()
            await new Promise(resolve => setTimeout(resolve, 0))
            expect(process.cancel).toHaveBeenCalledTimes(1)
            expect(process.finally).toHaveBeenCalledTimes(1)
            expect(reported).toHaveBeenCalledWith(failure)
        } finally {
            Dragging.usePointerLock = false
            delete (window as {reportError?: unknown}).reportError
        }
    })

    it("cancels when a granted lock ends before pointerup", async () => {
        Dragging.usePointerLock = true
        try {
            let locked: Element | null = null
            Object.defineProperty(document, "pointerLockElement", {configurable: true, get: () => locked})
            document.exitPointerLock = vi.fn(() => {locked = null})
            let grant: () => void = () => {}
            target.requestPointerLock = vi.fn(() => new Promise<void>(resolve => {grant = () => {locked = target; resolve()}}))
            const process = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
            attachment = Dragging.attach(target, () => Option.wrap(process), {pointerLock: true, pointerLockThreshold: 200})
            pointer(target, "pointerdown")
            pointer(target, "pointermove")
            grant()
            await Promise.resolve()
            ;(target.releasePointerCapture as (id: number) => void)(1)
            pointer(target, "lostpointercapture")
            expect(process.cancel).not.toHaveBeenCalled()
            locked = null
            document.dispatchEvent(new Event("pointerlockchange"))
            expect(process.cancel).toHaveBeenCalledTimes(1)
            expect(process.approve).not.toHaveBeenCalled()
        } finally {
            Dragging.usePointerLock = false
        }
    })

    it("does not let a retired drag's delayed lock shield a replacement drag", async () => {
        Dragging.usePointerLock = true
        try {
            let locked: Element | null = null
            Object.defineProperty(document, "pointerLockElement", {configurable: true, get: () => locked})
            document.exitPointerLock = vi.fn(() => {locked = null})
            const grants: Array<() => void> = []
            target.requestPointerLock = vi.fn(() => new Promise<void>(resolve => {grants.push(() => {locked = target; resolve()})}))
            const first = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
            const second = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
            const processes = [first, second]
            attachment = Dragging.attach(target, () => Option.wrap(processes.shift()!), {pointerLock: true, pointerLockThreshold: 200})
            pointer(target, "pointerdown")
            pointer(target, "pointermove")
            pointer(target, "pointerup")
            pointer(target, "pointerdown", 2)
            // The retired drag's grant takes capture from the replacement drag.
            grants[0]()
            pointer(target, "lostpointercapture", 2)
            await Promise.resolve()
            expect(second.cancel).toHaveBeenCalledTimes(1)
            expect(locked).toBe(null)
        } finally {
            Dragging.usePointerLock = false
        }
    })

    it("still cancels when capture is lost without a pointer lock", () => {
        const process = {update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), finally: vi.fn()}
        attachment = Dragging.attach(target, () => Option.wrap(process))
        pointer(target, "pointerdown")
        pointer(target, "lostpointercapture")
        expect(process.cancel).toHaveBeenCalledTimes(1)
        expect(process.approve).not.toHaveBeenCalled()
    })

    it.each(["pointerup", "pointercancel", "dispose", "replacement", "reattach"])("retires a deferred lock after %s", async end => {
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
        if (end === "dispose" || end === "reattach") {attachment.terminate()}
        else if (end !== "replacement") {pointer(target, end)}
        if (end === "reattach") {
            attachment = Dragging.attach(target, () => Option.wrap(process), {pointerLock: true, pointerLockThreshold: 200})
        }
        if (end === "replacement" || end === "reattach") {
            pointer(target, "pointerdown", 2)
            pointer(target, "pointermove", 2)
            expect(target.requestPointerLock).toHaveBeenCalledTimes(1)
        }
        resolvers[0]()
        await Promise.resolve()
        expect(locked).toBe(null)
        expect(document.exitPointerLock).toHaveBeenCalledTimes(1)
        if (end === "replacement" || end === "reattach") {
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
