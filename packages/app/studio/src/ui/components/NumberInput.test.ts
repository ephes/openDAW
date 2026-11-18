import {afterEach, expect, it, vi} from "vitest"
import {StringMapping, Terminator, ValueGuard} from "@opendaw/lib-std"
import {audioGestureFixture} from "@/ui/timeline/editors/audio/AudioEditorGestures.test-fixture"
import {EditWrapper} from "@/ui/wrapper/EditWrapper"
import {NumberInput} from "./NumberInput"

vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
})
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "number-input-test"}}
})

const lifecycle = new Terminator()
afterEach(() => {lifecycle.terminate(); document.body.replaceChildren()})

const setup = (step = 0.001, guard?: ValueGuard<number>) => {
    const fixture = audioGestureFixture("region")
    lifecycle.own({terminate: fixture.close})
    const model = EditWrapper.forValue(fixture.editing, fixture.reader.audioContent.waveformOffset)
    model.setValue(0.5)
    fixture.editing.mark()
    const control = NumberInput({lifecycle, model, step, guard, mapper: StringMapping.numeric({fractionDigits: 3})})
    document.body.append(control)
    const input = control.firstElementChild as HTMLElement
    input.focus()
    const key = (code: string, isComposing = false, character?: string) => {
        const event = new KeyboardEvent("keydown", {code, key: character, bubbles: true, cancelable: true, isComposing})
        input.dispatchEvent(event)
        return event
    }
    return {fixture, model, input, key}
}

it.each(["1e309", "Infinity"])("restores a nonfinite draft on blur (%s)", draft => {
    const {model, input} = setup()
    input.textContent = draft
    input.blur()
    expect(model.getValue()).toBe(0.5)
    expect(Number(input.textContent)).toBe(0.5)
})

it("refuses overflowing arrow arithmetic and restores the waveform offset display", () => {
    const {model, input, key} = setup(Number.MAX_VALUE)
    input.textContent = "1.7976931348623157e308"
    key("ArrowUp")
    expect(model.getValue()).toBe(0.5)
    expect(Number(input.textContent)).toBe(0.5)
})

it("refuses nonfinite guard output and keeps finite commits undoable", () => {
    const {fixture, model, input, key} = setup(0.001, {guard: value => value > 2 ? Infinity : value})
    input.textContent = "3"
    key("Enter")
    expect(model.getValue()).toBe(0.5)
    expect(Number(input.textContent)).toBe(0.5)
    input.focus()
    input.textContent = "1.25"
    key("Enter")
    expect(model.getValue()).toBe(1.25)
    expect(fixture.editing.undo()).toBe(true)
    expect(model.getValue()).toBe(0.5)
})

it.each([["Period", "."], ["NumpadDecimal", "."], ["Home", "Home"], ["End", "End"], ["Delete", "Delete"],
    ["Digit1", "1"], ["Numpad5", "5"], ["ArrowLeft", "ArrowLeft"], ["ArrowRight", "ArrowRight"], ["Backspace", "Backspace"]])(
    "allows native editing for %s", (code, character) => {
        const {key} = setup()
        expect(key(code, false, character).defaultPrevented).toBe(false)
    })

it.each(["Period", "NumpadDecimal"])("refuses %s on an integer-step control", code => {
    const {key} = setup(1)
    expect(key(code, false, ".").defaultPrevented).toBe(true)
    expect(key("Digit1", false, "1").defaultPrevented).toBe(false)
    expect(key("ArrowLeft", false, "ArrowLeft").defaultPrevented).toBe(false)
})

it.each([["NumpadDecimal", ","], ["Period", ":"]])("refuses %s typing %s instead of truncating the draft", (code, character) => {
    const {key} = setup()
    expect(key(code, false, character).defaultPrevented).toBe(true)
})

it("leaves composition Enter native without committing or reaching ancestors", () => {
    const {input, key, model} = setup()
    const ancestor = vi.fn()
    document.body.addEventListener("keydown", ancestor, {once: true})
    input.textContent = "1.25"
    try {
        expect(key("Enter", true).defaultPrevented).toBe(false)
        expect(ancestor).not.toHaveBeenCalled()
        expect(model.getValue()).toBe(0.5)
        expect(document.activeElement).toBe(input)
        key("Enter")
        expect(model.getValue()).toBe(1.25)
    } finally {
        document.body.removeEventListener("keydown", ancestor)
    }
})
