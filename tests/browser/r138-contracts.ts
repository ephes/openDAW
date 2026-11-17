import {assert, DefaultObservableValue, Terminable, Terminator, tryCatch, UUID} from "@opendaw/lib-std"
import {AnimationFrame} from "@opendaw/lib-dom"
import {Peaks} from "@opendaw/lib-fusion"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, CaptureMidiBox, TrackBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {AudioRegionBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {AudioUnitType} from "@opendaw/studio-enums"
import {TimeBase} from "@opendaw/lib-dsp"
import {Project, ProjectEnv} from "@opendaw/studio-core"
import {NumberInput} from "@/ui/components/NumberInput"
import {TextInput} from "@/ui/components/TextInput"
import {TimeCodeInput} from "@/ui/components/TimeCodeInput"
import {EditWrapper} from "@/ui/wrapper/EditWrapper"
import {PianoModePanel} from "@/ui/piano-panel/PianoModePanel"
import {PanelContent} from "@/ui/workspace/PanelContent"
import {PanelState} from "@/ui/workspace/PanelState"
import {PanelType} from "@/ui/workspace/PanelType"
import {Surface} from "@/ui/surface/Surface"
import {RegionTransformer} from "@/ui/timeline/tracks/audio-unit/regions/RegionTransformer"
import type {StudioService} from "@/service/StudioService"

const projectFixture = () => {
    const context = new AudioContext()
    const project = Project.new({audioContext: context, sampleManager: {
        register: () => Terminable.Empty,
        getOrCreate: () => ({state: {type: "loaded"}, subscribe: () => Terminable.Empty})
    }} as unknown as ProjectEnv)
    return {project, close: async () => {project.terminate(); await context.close()}}
}
const paste = (element: HTMLElement, text: string) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData("application/json", text)
    const event = new ClipboardEvent("paste", {clipboardData, bubbles: true, cancelable: true})
    element.dispatchEvent(event)
    return event.defaultPrevented
}

export const controls = async () => {
    const {project, close} = projectFixture()
    const lifecycle = new Terminator()
    const {label} = project.primaryAudioBusBox
    project.editing.modify(() => label.setValue("original"))
    const text = TextInput({lifecycle, model: EditWrapper.forValue(project.editing, label), maxChars: 12})
    document.body.append(text)
    const input = text.firstElementChild as HTMLElement
    input.focus()
    assert(paste(text, JSON.stringify({app: "openDAW", content: "text", value: "new-name"})), "accepted text paste")
    assert(input.textContent === "new-name", "visible paste")
    project.editing.mark()
    project.editing.undo()
    assert(input.textContent === "original", "visible undo")
    project.editing.redo()
    assert(input.textContent === "new-name", "visible redo")
    input.textContent = "typing"
    const node = input.firstChild!
    const selection = window.getSelection()!
    selection.setBaseAndExtent(node, 3, node, 3)
    input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "g"}))
    assert(selection.anchorNode === node && selection.anchorOffset === 3, "caret retained")
    for (const [content, create] of [["number", NumberInput], ["timecode", TimeCodeInput]] as const) {
        const model = new DefaultObservableValue(12)
        const element = create({lifecycle, model})
        document.body.append(element)
        for (const payload of ["null", "{", "[]", `{"app":"openDAW","content":"${content}","value":1e309}`,
            JSON.stringify({app: "openDAW", content, value: {bad: true}})]) {
            assert(!paste(element, payload) && model.getValue() === 12, "invalid numeric paste")
        }
        assert(paste(element, JSON.stringify({app: "openDAW", content, value: 24})) && model.getValue() === 24, "valid numeric paste")
        element.remove()
    }
    assert(!paste(text, JSON.stringify({app: "openDAW", content: "text", value: "x".repeat(13)})), "bounded text")
    lifecycle.terminate()
    project.editing.modify(() => label.setValue("closed"))
    assert(input.textContent === "typing", "retired text subscription")
    text.remove()
    await close()
}

export const pianoAndAudio = async () => {
    const {project, close} = projectFixture()
    const {boxGraph, editing} = project
    const unit = editing.modify(() => {
        const capture = CaptureMidiBox.create(boxGraph, UUID.generate())
        return AudioUnitBox.create(boxGraph, UUID.generate(), box => {
            box.type.setValue(AudioUnitType.Instrument); box.capture.refer(capture)
            box.collection.refer(project.rootBox.audioUnits); box.output.refer(project.primaryAudioBusBox.input)
        })
    }).unwrap()
    const add = (type: TrackType, index: number) => editing.modify(() => TrackBox.create(boxGraph, UUID.generate(), box => {
        box.tracks.refer(unit.tracks); box.target.refer(unit); box.type.setValue(type); box.index.setValue(index)
    })).unwrap()
    const first = add(TrackType.Notes, 0)
    const lifecycle = new Terminator()
    AnimationFrame.start(window)
    const panel = PianoModePanel({lifecycle, service: {hasProfile: true, project} as StudioService}) as HTMLElement
    document.body.append(panel)
    const inputs = () => Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).slice(1)
    assert(inputs().length === 1, "initial piano track")
    const second = add(TrackType.Notes, 1)
    assert(inputs().length === 2, "added piano track")
    editing.modify(() => {second.excludePianoMode.setValue(true); second.index.setValue(-1)})
    assert(!inputs()[0].checked && inputs()[1].checked, "reordered piano exclusions")
    editing.modify(() => second.delete())
    assert(inputs().length === 1, "removed piano track")
    editing.modify(() => first.delete())
    assert(inputs().length === 0, "empty piano roster")
    const track = add(TrackType.Audio, 0)
    const region = editing.modify(() => {
        const file = AudioFileBox.create(boxGraph, UUID.generate())
        const events = ValueEventCollectionBox.create(boxGraph, UUID.generate())
        return AudioRegionBox.create(boxGraph, UUID.generate(), box => {
            box.regions.refer(track.regions); box.file.refer(file); box.events.refer(events.owners)
            box.timeBase.setValue(TimeBase.Seconds); box.position.setValue(7680)
            box.duration.setValue(2); box.loopDuration.setValue(2); box.waveformOffset.setValue(1.25)
        })
    }).unwrap()
    const clip = editing.modify(() => RegionTransformer.toClip(project.boxAdapters.adapterFor(region, AudioRegionBoxAdapter), false)).unwrap()
    assert(clip.duration.getValue() === 2, "native seconds duration")
    const offset = (clip as import("@opendaw/studio-boxes").AudioClipBox).waveformOffset.getValue()
    assert(offset === 1.25, "native waveform offset")
    const render = async (sourceOffset: number) => {
        const context = new OfflineAudioContext(1, 128, 48000)
        const buffer = context.createBuffer(1, 96000, 48000)
        const samples = buffer.getChannelData(0)
        for (let index = 0; index < samples.length; index++) {samples[index] = index / samples.length}
        const source = context.createBufferSource()
        source.buffer = buffer; source.connect(context.destination); source.start(0, sourceOffset)
        return Array.from((await context.startRendering()).getChannelData(0))
    }
    const original = await render(region.waveformOffset.getValue()), converted = await render(offset)
    assert(original.every((sample, index) => sample === converted[index]), "source sample selection")
    for (const [bits, expected] of [[0x3800, 0.5], [0x3c00, 1], [0x4000, 2]]) {
        assert(Peaks.unpack(bits | bits << 16, 0) === expected && Peaks.unpack(bits | bits << 16, 1) === expected, "exact peak unpack")
    }
    await new Promise(requestAnimationFrame)
    lifecycle.terminate(); panel.remove()
    editing.modify(() => unit.delete())
    await close()
}

export const panels = () => {
    if (!Surface.isAvailable()) {Surface.main({config() {}}, {install() {}} as unknown as Parameters<typeof Surface.main>[1])}
    const container = document.createElement("div")
    document.body.append(container)
    let fail = true, disposed = 0
    const content = new PanelContent({create: lifecycle => {
        lifecycle.own({terminate: () => disposed++})
        if (fail) {throw new Error("synthetic factory failure")}
        return document.createElement("article")
    }}, PanelType.Notepad)
    const state = {isMinimized: false, minimizable: true, popoutable: true, name: "Synthetic"} as PanelState
    const listener = {onEmbed() {}, onPopout() {}, onMinimized() {}}
    assert(tryCatch(() => content.bind(state, container, listener)).status === "failure" && disposed === 1, "factory rollback")
    fail = false
    const first = content.bind(state, container, listener)
    first.terminate()
    const second = content.bind(state, container, listener)
    first.toggleMinimize(); first.togglePopout(); first.terminate()
    assert(container.children.length === 1 && !state.isMinimized, "stale binding inert")
    second.terminate(); second.terminate()
    assert(disposed === 3, "exact lifecycle cleanup")
    container.remove()
}
