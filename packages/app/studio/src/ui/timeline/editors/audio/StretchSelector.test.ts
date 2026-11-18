import {afterEach, expect, it, vi} from "vitest"
import {AudioData, TimeBase} from "@opendaw/lib-dsp"
import {RuntimeNotifier, Terminable, Terminator} from "@opendaw/lib-std"
import {Project, Workers} from "@opendaw/studio-core"
import {audioGestureFixture} from "./AudioEditorGestures.test-fixture"
import {StretchSelector} from "./StretchSelector"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
vi.mock("@opendaw/lib-dom", async importOriginal => {
    const original = await importOriginal<typeof import("@opendaw/lib-dom")>()
    return {...original, Html: {...original.Html, adoptStyleSheet: () => "stretch-selector-test"}}
})
vi.mock("@/ui/surface/TextTooltip.tsx", () => ({TextTooltip: {simple: () => Terminable.Empty}}))

const lifecycle = new Terminator()
afterEach(() => {
    lifecycle.terminate()
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

const setup = () => {
    const fixture = audioGestureFixture("clip", {duration: 2, timeBase: TimeBase.Seconds})
    lifecycle.own({terminate: fixture.close})
    const {reader, editing, box} = fixture
    editing.modify(() => box.playMode.defer())
    editing.markSaved()
    const audioContent = reader.audioContent
    vi.spyOn(audioContent.file, "audioData", "get").mockResolvedValue(AudioData.create(48000, 16, 1))
    const detect = vi.fn<() => Promise<number[]>>()
    vi.spyOn(Workers, "Transients", "get").mockReturnValue({detect})
    const editor = lifecycle.own(new Terminator())
    const element = StretchSelector({lifecycle: editor, reader, project: {editing} as Project})
    document.body.append(element)
    const radios = element.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    const mode = () => audioContent.isPlayModeNoStretch ? 0 : audioContent.asPlayModePitchStretch.nonEmpty() ? 1 : 2
    return {editing, audioContent, editor, detect, radios, mode}
}

it("keeps No Warp authoritative while earlier transient detection completes", async () => {
    const {editing, detect, radios, mode} = setup()
    const pending = Promise.withResolvers<number[]>()
    detect.mockReturnValueOnce(pending.promise)
    radios[2].click()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    radios[0].click()
    pending.resolve([0, 1])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(mode()).toBe(0)
    expect(radios[0].checked).toBe(true)
    expect(editing.hasUnsavedChanges()).toBe(false)
})

it("applies only the latest request when transient detections resolve out of order", async () => {
    const {editing, audioContent, detect, radios, mode} = setup()
    const first = Promise.withResolvers<number[]>()
    const second = Promise.withResolvers<number[]>()
    detect.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    radios[2].click()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    radios[1].click()
    await vi.waitFor(() => expect(mode()).toBe(1))
    radios[2].click()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(2))
    second.resolve([0, 1])
    await vi.waitFor(() => expect(mode()).toBe(2))
    first.resolve([0, 0.5])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(audioContent.file.transients.asArray().map(marker => marker.position)).toEqual([0, 1])
    expect(radios[2].checked).toBe(true)
    expect(editing.undo()).toBe(true)
    expect(mode()).toBe(1)
    expect(radios[1].checked).toBe(true)
})

it("retires a queued conversion when the selector closes", async () => {
    const {editing, editor, detect, radios, mode} = setup()
    const pending = Promise.withResolvers<number[]>()
    detect.mockReturnValueOnce(pending.promise)
    radios[2].click()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    editor.terminate()
    pending.resolve([0, 1])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(mode()).toBe(0)
    expect(editing.hasUnsavedChanges()).toBe(false)
})

it("reconciles the radio when the latest request rejects", async () => {
    const warning = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
    const {editing, detect, radios, mode} = setup()
    const pending = Promise.withResolvers<number[]>()
    detect.mockReturnValueOnce(pending.promise)
    radios[2].click()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    pending.reject(new Error("synthetic transient failure"))
    await vi.waitFor(() => expect(radios[0].checked).toBe(true))
    expect(mode()).toBe(0)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(editing.hasUnsavedChanges()).toBe(false)
})
