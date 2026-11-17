import {afterEach, describe, expect, it, vi} from "vitest"
import {installAutoScroll} from "./AutoScroll"
const frames = vi.hoisted(() => [] as Array<{callback: () => void, terminate: ReturnType<typeof vi.fn>}> )
vi.mock("@/ui/surface/Surface.tsx", () => ({Surface: {get: () => ({owner: {document}})}}))
vi.mock("@opendaw/lib-dom", async original => ({...await original<object>(), AnimationFrame: {
    add: (callback: () => void) => {const frame = {callback, terminate: vi.fn()}; frames.push(frame); return frame}
}}))
const event = (target: EventTarget, type: string, pointerId = 1, clientX = 200) => {
    target.dispatchEvent(Object.assign(new Event(type), {pointerId, clientX, clientY: 0}))
}
afterEach(() => {frames.length = 0})
const setup = () => {
    const target = document.createElement("div")
    const scroll = vi.fn(), measure = vi.fn(() => ({xMin: 0, xMax: 100, yMin: 0, yMax: 100}))
    const owner = installAutoScroll(target, scroll, {measure})
    event(target, "pointerdown")
    event(document, "pointermove")
    return {target, scroll, measure, owner, frame: frames[0]}
}
describe("auto scroll ownership", () => {
    it("retirement fences queued frames and removes active subscriptions", () => {
        const {target, owner, frame, measure, scroll} = setup()
        owner.terminate(); owner.terminate()
        event(document, "pointermove"); event(target, "pointerdown")
        frame.callback()
        expect(frame.terminate).toHaveBeenCalledOnce()
        expect(measure).toHaveBeenCalledOnce()
        expect(scroll).not.toHaveBeenCalled()
    })
    it("ignores other pointer movement and completion", () => {
        const {target, owner, frame, measure, scroll} = setup()
        event(target, "pointerdown", 2)
        event(document, "pointermove", 2, -100)
        event(document, "pointerup", 2)
        frame.callback()
        expect(measure).toHaveBeenCalledOnce()
        expect(scroll).toHaveBeenLastCalledWith(100, 0)
        expect(frame.terminate).not.toHaveBeenCalled()
        event(document, "pointerup", 1)
        expect(frame.terminate).toHaveBeenCalledOnce()
        owner.terminate()
    })
    it.each(["pointercancel", "pointerup", "dragend", "blur"])("stops on %s", type => {
        const {owner, frame, measure, scroll} = setup()
        event(type === "blur" ? window : document, type)
        event(document, "pointermove"); frame.callback()
        expect(frame.terminate).toHaveBeenCalledOnce()
        expect(measure).toHaveBeenCalledOnce()
        expect(scroll).not.toHaveBeenCalled()
        owner.terminate()
    })
    it("preserves native dragover and dragend", () => {
        const {owner, frame, scroll} = setup()
        event(document, "dragstart")
        event(document, "pointercancel")
        event(document, "dragover", 0, -50)
        frame.callback()
        expect(scroll).toHaveBeenCalledWith(-50, 0)
        event(document, "dragend", 0)
        expect(frame.terminate).toHaveBeenCalledOnce()
        owner.terminate()
    })
})
