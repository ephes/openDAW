import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, MutableObservableOption, Terminator} from "@opendaw/lib-std"
import {MidiDevices} from "@opendaw/studio-core"
import type {Project} from "@opendaw/studio-core"
import type {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {DeviceSelector} from "./DeviceSelector"
vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix}}
})
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("span")}))
vi.mock("@/ui/components/MenuButton", () => ({MenuButton: (_: unknown, children: HTMLElement[]) => children}))
afterEach(() => vi.restoreAllMocks())
it("refreshes current port availability on permission and state changes without graph edits; releases access listeners", () => {
    const access = new MutableObservableOption<MIDIAccess>()
    vi.spyOn(MidiDevices, "get").mockReturnValue(access)
    const output = {id: new DefaultObservableValue("a"), label: new DefaultObservableValue("Synthetic port"),
        delayInMs: new DefaultObservableValue(0), sendTransportMessages: new DefaultObservableValue(true)}
    const midiDevice = new MutableObservableOption<typeof output>(); midiDevice.wrap(output)
    const adapter = {box: {device: {}}, midiDevice} as unknown as MIDIOutputDeviceBoxAdapter
    const modify = vi.fn((change: () => void) => change())
    const lifecycle = new Terminator()
    const element = DeviceSelector({lifecycle, project: {editing: {modify}} as unknown as Project, adapter}) as HTMLElement
    const label = element.querySelector(".device-label")!
    expect(label.classList.contains("not-available")).toBe(true)
    modify.mockClear()
    const target = new EventTarget()
    const outputs = new Map([["a", {id: "a", state: "connected"}]])
    const midi = Object.assign(target, {outputs}) as unknown as MIDIAccess
    const remove = vi.spyOn(midi, "removeEventListener")
    access.wrap(midi)
    expect(label.classList.contains("not-available")).toBe(false)
    outputs.get("a")!.state = "disconnected"; target.dispatchEvent(new Event("statechange"))
    expect(label.classList.contains("not-available")).toBe(true)
    outputs.get("a")!.state = "connected"; target.dispatchEvent(new Event("statechange"))
    expect(label.classList.contains("not-available")).toBe(false)
    output.id.setValue("b"); expect(label.classList.contains("not-available")).toBe(true)
    outputs.set("b", {id: "b", state: "connected"}); target.dispatchEvent(new Event("statechange"))
    expect(label.classList.contains("not-available")).toBe(false)
    access.clear(); expect(remove).toHaveBeenCalledTimes(1)
    access.wrap(midi)
    lifecycle.terminate(); expect(remove).toHaveBeenCalledTimes(2)
    outputs.get("b")!.state = "disconnected"; target.dispatchEvent(new Event("statechange"))
    expect(modify).not.toHaveBeenCalled()
    expect(output.id.getValue()).toBe("b")
    expect(label.classList.contains("not-available")).toBe(false)
})
