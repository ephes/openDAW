import {GlobalShortcuts} from "@/ui/shortcuts/GlobalShortcuts"
import {NotePadPanel} from "@/ui/NotePadPanel"
import {renderMarkdown} from "@/ui/Markdown"
import {ShortcutManager, Events} from "@opendaw/lib-dom"
import {Terminator} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"

export const setupNotes = (initial: string) => {
    let saved = initial
    let lifecycle: Terminator
    let panel: Element
    const mount = () => {
        lifecycle = new Terminator()
        const service = {profile: {meta: {notepad: saved}, updateMetaData: (_: string, text: string) => {saved = text}}}
        panel = NotePadPanel({lifecycle, service: service as unknown as StudioService})
        document.body.replaceChildren(panel)
        lifecycle.own(Events.subscribe(window, "keydown", event => ShortcutManager.get().handleEvent(event)))
        lifecycle.own(ShortcutManager.get().global.register(GlobalShortcuts["project-save"].shortcut, () => {}, {activeInTextField: true}))
    }
    mount()
    return {
        read: () => saved,
        close: () => {lifecycle.terminate(); panel.remove()},
        reopen: () => {lifecycle.terminate(); panel.remove(); mount()}
    }
}

export const setupLinks = () => {
    const element = document.createElement("div")
    renderMarkdown(element, "[query](/manuals/topic?mode=x#section) [section](#section) [plain](/manuals/topic)")
    const section = document.createElement("div")
    section.id = "section"
    section.textContent = "Destination"
    section.style.marginTop = "2000px"
    document.body.replaceChildren(element, section)
    return (label: string, options: MouseEventInit = {}) => {
        const anchor = Array.from(element.querySelectorAll("a")).find(a => a.textContent === label)!
        const event = new PointerEvent("click", {bubbles: true, cancelable: true, ...options})
        // Observe the component handler without following the synthetic event's default action.
        anchor.onclick?.call(anchor, event)
        return event.defaultPrevented
    }
}

export const setupGain = async () => {
    const {AutoGainButton} = await import("@/ui/devices/audio-effects/StereoTool/AutoGainButton")
    const lifecycle = new Terminator()
    const listeners = new Set<(peaks: Float32Array) => void>()
    let volume = 0, edits = 0
    const element = AutoGainButton({lifecycle,
        project: {editing: {modify: (change: () => void) => {edits++; change()}}, liveStreamReceiver: {
            subscribeFloats: (_: unknown, listener: (peaks: Float32Array) => void) => {
                listeners.add(listener); return {terminate: () => {listeners.delete(listener)}}
            }
        }} as unknown as import("@opendaw/studio-core").Project,
        adapter: ({address: {}, namedParameter: {volume: {getValue: () => volume, setValue: (value: number) => {volume = value}}}} as unknown as import("@opendaw/studio-adapters").StereoToolDeviceBoxAdapter)
    }) as HTMLElement
    const button = element.querySelector<HTMLElement>('[class^="AutoGainButton"]')!
    button.id = "gain"
    button.style.cssText = "width:100px;height:100px"
    document.body.replaceChildren(element)
    return {read: () => ({volume, edits, listeners: listeners.size, probing: button.classList.contains("probing")}),
        peaks: (peaks: number[]) => listeners.forEach(listener => listener(new Float32Array(peaks))),
        close: () => lifecycle.terminate()}
}

export const microphoneFallback = async () => {
    const {AudioDevices} = await import("@/audio/AudioDevices")
    let stopped = 0
    const constraints: MediaStreamConstraints[] = []
    const missing = new DOMException("Synthetic removed input", "OverconstrainedError")
    Object.defineProperty(navigator, "permissions", {configurable: true, value: {
        query: async () => {throw new TypeError("Synthetic unsupported microphone query")}
    }})
    Object.defineProperty(navigator, "mediaDevices", {configurable: true, value: {
        getUserMedia: async (request: MediaStreamConstraints) => {
            constraints.push(request)
            const audio = request.audio as MediaTrackConstraints
            if (typeof audio.deviceId === "object" && !Array.isArray(audio.deviceId) && audio.deviceId.exact === "removed") {throw missing}
            return {getTracks: () => [{stop: () => {stopped++}}]}
        },
        enumerateDevices: async () => [{kind: "audioinput", deviceId: "synthetic", label: "Synthetic input"}]
    }})
    const devices = await AudioDevices.queryListInputDevices()
    let refused = false
    try {await AudioDevices.queryAudioInputDeviceStream(48000, "removed")} catch (error) {refused = error === missing}
    await AudioDevices.queryAudioInputDeviceStream(48000)
    return {devices: devices.length, stopped, refused,
        selectors: constraints.map(request => (request.audio as MediaTrackConstraints).deviceId ?? null)}
}
