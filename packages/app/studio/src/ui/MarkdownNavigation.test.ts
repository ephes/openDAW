import {afterEach, expect, it, vi} from "vitest"
import {RouteLocation} from "@opendaw/lib-jsx"
import {renderMarkdown} from "./Markdown"

vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "synthetic-style"}}
})

afterEach(() => vi.restoreAllMocks())
const click = (destination: string, options: MouseEventInit = {}) => {
    const element = document.createElement("div")
    renderMarkdown(element, `[synthetic](${destination})`)
    const anchor = element.querySelector("a")!
    const event = new MouseEvent("click", {cancelable: true, ...options})
    anchor.onclick?.call(anchor, event as PointerEvent)
    return event.defaultPrevented
}
it("leaves a same-document fragment to native scrolling", () => {
    const navigate = vi.spyOn(RouteLocation.get(), "navigateTo")
    expect(click("#section")).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
})
it.each(["/manuals/topic?mode=x#section", "/manuals/topic?mode=x", "/manuals/topic#section"])(
    "routes %s with its complete destination instead of reloading the studio", destination => {
        const navigate = vi.spyOn(RouteLocation.get(), "navigateTo").mockReturnValue(true)
        expect(click(destination)).toBe(true)
        expect(navigate).toHaveBeenCalledWith(destination)
    })
it.each([{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}])(
    "preserves browser click semantics %s", options => {
        expect(click("/manuals/topic", options)).toBe(false)
    })
it("still routes an ordinary same-origin path", () => {
    const navigate = vi.spyOn(RouteLocation.get(), "navigateTo").mockReturnValue(true)
    expect(click("/manuals/topic")).toBe(true)
    expect(navigate).toHaveBeenCalledWith("/manuals/topic")
})
