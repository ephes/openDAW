import {expect, it, vi} from "vitest"
import {DefaultObservableValue, Terminator} from "@opendaw/lib-std"
import {NumberInput} from "./NumberInput"
import {TextInput} from "./TextInput"
import {TimeCodeInput} from "./TimeCodeInput"

vi.hoisted(() => {
    document.adoptedStyleSheets = []
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
})
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "control-test"}}
})
const paste = (element: HTMLElement, text: string) => {
    const event = new Event("paste", {bubbles: true, cancelable: true})
    Object.defineProperty(event, "clipboardData", {value: {getData: () => text}})
    element.dispatchEvent(event)
    return event.defaultPrevented
}

it.each(["number", "timecode", "text"] as const)("admits only typed, bounded %s clipboard payloads and retains native fallback", content => {
    const lifecycle = new Terminator()
    const numeric = new DefaultObservableValue(12)
    const text = new DefaultObservableValue("original")
    const element = content === "number" ? NumberInput({lifecycle, model: numeric, guard: {guard: value => Math.min(20, value)}})
        : content === "timecode" ? TimeCodeInput({lifecycle, model: numeric})
        : TextInput({lifecycle, model: text, maxChars: 8})
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {errors.push(event.error); event.preventDefault()}
    window.addEventListener("error", onError)
    for (const malformed of ["null", "0", '"text"', "[]", "{", "", '{}',
        ...[null, [], {}, true, content === "text" ? 1 : "3"].map(value => JSON.stringify({app: "openDAW", content, value})),
        JSON.stringify({app: "other", content, value: 3}),
        JSON.stringify({app: "openDAW", content: "other", value: 3}),
        `{"app":"openDAW","content":"${content}","value":1e309}`,
        JSON.stringify({app: "openDAW", content, value: "x".repeat(9)})]) {
        expect(paste(element, malformed), malformed).toBe(false)
        expect(numeric.getValue()).toBe(12)
        expect(text.getValue()).toBe("original")
    }
    expect(errors).toEqual([])
    expect(paste(element, JSON.stringify({app: "openDAW", content, value: content === "text" ? "accepted" : 23}))).toBe(true)
    expect(content === "text" ? text.getValue() : numeric.getValue()).toBe(content === "text" ? "accepted" : content === "number" ? 20 : 23)
    window.removeEventListener("error", onError)
    lifecycle.terminate()
})

it("updates text after paste, external edits and history, while preserving an unchanged edit node", () => {
    const lifecycle = new Terminator()
    const model = new DefaultObservableValue("original")
    const element = TextInput({lifecycle, model})
    const input = element.firstElementChild as HTMLElement
    paste(element, JSON.stringify({app: "openDAW", content: "text", value: "new-name"}))
    expect(input.textContent).toBe("new-name")
    model.setValue("external")
    expect(input.textContent).toBe("external")
    input.textContent = "typing"
    const node = input.firstChild
    input.dispatchEvent(new Event("input", {bubbles: true}))
    expect(model.getValue()).toBe("typing")
    expect(input.firstChild).toBe(node)
    lifecycle.terminate()
    model.setValue("closed")
    expect(input.textContent).toBe("typing")
})
