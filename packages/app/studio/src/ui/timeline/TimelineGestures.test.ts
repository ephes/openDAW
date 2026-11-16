import {afterEach, expect, it, vi} from "vitest"
import {Dragging} from "@opendaw/lib-dom"

vi.mock("@/ui/menu/debug", () => ({DebugMenus: {}}))
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

const fixture = async () => {
    vi.stubGlobal("AudioWorkletNode", class {})
    return import("../../../../../../tests/browser/r114-gestures")
}

it("preserves note and slope ownership using real graph generations and undo", async () => {
    const {noteAndSlope} = await fixture()
    expect(noteAndSlope()).toEqual({preview: [0, 4, 90], committed: [0, 4, 90], restored: [2, 6, 90], audition: [0],
        oneMotion: true, preserved: true, segmentPreserved: true, contentCount: 3, linear: "linear"})
})

it.each(["approve", "cancel", "external", "insert"])("warp preview %s preserves graph and history", async action => {
    const {setupWarp} = await fixture()
    let create!: Parameters<typeof Dragging.attach>[1]
    let process: Dragging.Process | undefined
    vi.spyOn(Dragging, "attach").mockImplementation((_target, factory) => {
        create = factory
        return {terminate: () => process?.cancel?.()}
    })
    const h = setupWarp()
    try {
        process = create({clientX: 250, clientY: 30} as PointerEvent).unwrap()
        process.update({clientX: 400, clientY: 30, ctrlKey: false, shiftKey: true, altKey: false})
        expect(h.read()).toEqual({position: 1000, preview: 1600, undo: true})
        if (action === "external") {h.external()}
        if (action === "insert") {h.insert()}
        if (action === "cancel") {process.cancel!()} else {process.approve!()}
        const position = action === "approve" ? 1600 : action === "external" ? 1100 : action === "insert" ? 1260 : 1000
        expect(h.read()).toEqual({position, preview: null, undo: true})
        if (action === "approve" || action === "cancel") {
            h.undo()
            expect(h.read()).toEqual({position: 1000, preview: null, undo: action === "approve"})
            if (action === "approve") {
                h.undo() // pointer-down selection is a separate existing history entry
                expect(h.read()).toEqual({position: 1000, preview: null, undo: false})
            }
        }
    } finally {h.close()}
})

it.each(["pointercancel", "Escape", "dispose", "pointerup"])("settles the real drag lifecycle on %s", async finish => {
    const {setupWarp} = await fixture()
    const h = setupWarp()
    const element = document.querySelector<HTMLCanvasElement>("#gesture")!
    let captured = false
    element.setPointerCapture = () => {captured = true}
    element.hasPointerCapture = () => captured
    element.releasePointerCapture = () => {captured = false}
    const pointer = (type: string, x: number) => {
        const event = new MouseEvent(type, {clientX: x, clientY: 30, buttons: 1, bubbles: true})
        Object.defineProperties(event, {pointerId: {value: 1}, isPrimary: {value: true}, pointerType: {value: "mouse"}})
        element.dispatchEvent(event)
    }
    try {
        pointer("pointerdown", 250)
        pointer("pointermove", 400)
        expect(h.read()).toEqual({position: 1000, preview: 1600, undo: true})
        if (finish === "Escape") {window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))}
        else if (finish === "dispose") {h.dispose()}
        else {pointer(finish, 400)}
        expect(h.read()).toEqual({position: finish === "pointerup" ? 1600 : 1000, preview: null, undo: true})
        h.undo()
        expect(h.read().position).toBe(1000)
        if (finish === "pointerup") {h.undo()}
        expect(h.read().undo).toBe(false)
    } finally {h.close()}
})
