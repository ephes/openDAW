import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Terminator} from "@opendaw/lib-std"
import {OctaveSelector} from "./OctaveSelector"
import {SlotState} from "./SlotState"
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix}}
})
vi.mock("@/ui/devices/instruments/PlayfieldDeviceEditor/SlotUtils", () => ({SlotUtils: {color: () => "red"}}))
const owners: Terminator[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {owners.splice(0).forEach(owner => owner.terminate()); vi.clearAllTimers(); vi.useRealTimers()})
const fixture = () => {
    const lifecycle = new Terminator(); owners.push(lifecycle)
    const octave = new DefaultObservableValue(0), update = vi.spyOn(octave, "setValue")
    const element = OctaveSelector({lifecycle, octave, octaveIndex: 4,
        states: Array.from({length: 12}, () => new DefaultObservableValue(SlotState.Idle))}) as HTMLElement
    const child = element.querySelector("rect")!
    const send = (type: string) => child.dispatchEvent(new Event(type, {bubbles: true}))
    return {lifecycle, element, octave, update, send}
}
it.each(["dragleave", "drop", "teardown"])("retires nested enters on %s and clears the hover state", end => {
    const f = fixture()
    f.send("dragenter"); vi.advanceTimersByTime(200); f.send("dragenter")
    if (end === "teardown") {f.lifecycle.terminate()} else {f.send(end)}
    expect(f.element.classList.contains("drag-over")).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(2000)
    expect(f.octave.getValue()).toBe(0); expect(f.update).not.toHaveBeenCalled()
})
it("allows only the current continuous hover to switch once", () => {
    const f = fixture()
    f.send("dragenter"); vi.advanceTimersByTime(700); f.send("dragleave")
    f.send("dragenter"); vi.advanceTimersByTime(999)
    expect(f.octave.getValue()).toBe(0)
    vi.advanceTimersByTime(1); expect(f.octave.getValue()).toBe(4)
    vi.advanceTimersByTime(2000); expect(f.update).toHaveBeenCalledTimes(1)
    expect(f.element.classList.contains("drag-over")).toBe(false)
})
