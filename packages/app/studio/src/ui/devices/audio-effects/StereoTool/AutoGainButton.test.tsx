import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {AutoGainButton} from "./AutoGainButton"
import type {Project} from "@opendaw/studio-core"
import type {StereoToolDeviceBoxAdapter} from "@opendaw/studio-adapters"

vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: (_: string, prefix: string) => prefix}}
})
vi.mock("@/ui/components/Icon", () => ({Icon: () => document.createElement("span")}))
const owners: Terminator[] = []
beforeEach(() => {vi.useFakeTimers()})
afterEach(() => {owners.splice(0).forEach(owner => owner.terminate()); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks()})
const fixture = () => {
    const lifecycle = new Terminator()
    owners.push(lifecycle)
    let value = 0
    const volume = {getValue: () => value, setValue: vi.fn((next: number) => {value = next})}
    const listeners = new Set<(peaks: Float32Array) => void>()
    const editing = {modify: vi.fn((change: () => void) => change())}
    const project = {editing, liveStreamReceiver: {
        subscribeFloats: (_: unknown, listener: (peaks: Float32Array) => void) => {
            listeners.add(listener); return {terminate: () => {listeners.delete(listener)}}
        }
    }} as unknown as Project
    const adapter = {address: {}, namedParameter: {volume}} as unknown as StereoToolDeviceBoxAdapter
    const element = AutoGainButton({lifecycle, project, adapter}) as HTMLElement
    const button = element.querySelector<HTMLElement>(".AutoGainButton")!
    button.setPointerCapture = vi.fn()
    const send = (name: string, pointerId = 1) => {
        const event = new Event(name)
        Object.defineProperty(event, "pointerId", {value: pointerId})
        button.dispatchEvent(event)
    }
    return {lifecycle, volume, editing, button, send, listeners,
        peaks: (values: number[]) => listeners.forEach(listener => listener(new Float32Array(values)))}
}

it.each(["pointercancel", "lostpointercapture"])("retires %s once without applying gain and allows a new probe", event => {
    const f = fixture()
    f.send("pointerdown"); f.peaks([0.5, 0.5])
    expect(f.listeners.size).toBe(1)
    f.send(event); f.send("lostpointercapture")
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(f.button.classList.contains("probing")).toBe(false)
    expect(f.editing.modify).not.toHaveBeenCalled()
    f.send("pointerdown", 2); f.peaks([0.5, 0.5])
    vi.advanceTimersByTime(1000)
    f.send("pointerup", 2)
    expect(f.volume.setValue).toHaveBeenCalledTimes(1)
})

it("ignores unrelated pointers and keeps normal minimum-duration release after capture loss", () => {
    const f = fixture()
    f.send("pointerdown"); f.peaks([0.5, 0.5])
    f.send("pointercancel", 99); f.send("pointerup", 99)
    expect(vi.getTimerCount()).toBe(0)
    expect(f.listeners.size).toBe(1)
    f.send("pointerup"); f.send("lostpointercapture")
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(f.volume.setValue).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
})

it("disposal cancels a pending minimum-duration completion", () => {
    const f = fixture()
    f.send("pointerdown"); f.peaks([0.5, 0.5]); f.send("pointerup")
    f.lifecycle.terminate()
    vi.advanceTimersByTime(1000)
    expect(f.listeners.size).toBe(0)
    expect(f.editing.modify).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
})

it.each([[], [0.5], [NaN, 0.5], [0.5, NaN], [Infinity, 0.5], [-1, 0.5], [0, 0]].map(peaks => ({peaks})))(
    "refuses unusable stereo evidence %s before editing", ({peaks}) => {
        const f = fixture()
        f.send("pointerdown"); f.peaks(peaks)
        vi.advanceTimersByTime(1000); f.send("pointerup")
        expect(f.volume.setValue).not.toHaveBeenCalled()
        expect(f.editing.modify).not.toHaveBeenCalled()
        expect(f.volume.getValue()).toBe(0)
    })

it("ignores invalid frames without poisoning finite stereo normalization", () => {
    const f = fixture()
    f.send("pointerdown"); f.peaks([NaN, Infinity]); f.peaks([0.5, 0.25]); f.peaks([])
    vi.advanceTimersByTime(1000); f.send("pointerup")
    expect(f.volume.getValue()).toBeCloseTo(5.9206, 4)
    expect(f.editing.modify).toHaveBeenCalledTimes(1)
})

it("does not open an edit for a nonfinite computed gain", () => {
    const f = fixture()
    f.volume.setValue(NaN)
    f.send("pointerdown"); f.peaks([0.5, 0.5])
    vi.advanceTimersByTime(1000); f.send("pointerup")
    expect(f.editing.modify).not.toHaveBeenCalled()
})
