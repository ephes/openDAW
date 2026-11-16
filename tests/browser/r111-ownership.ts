import {Option, UUID} from "@opendaw/lib-std"
import {CompressorDeviceBox, CaptureAudioBox} from "@opendaw/studio-boxes"
import {FilteredSelection, DeviceBoxAdapter, ProjectSkeleton} from "@opendaw/studio-adapters"
import {Project, ProjectEnv, DevicesClipboard, AudioUnitsClipboard, Recording, Capture, CaptureAudio, CaptureDevices, AudioDevices} from "@opendaw/studio-core"

export const clipboardOwnership = () => {
    const project = Project.new({} as ProjectEnv, {noDefaultUser: true})
    const {boxGraph: graph, editing, primaryAudioUnitBox: output} = project
    let copyable!: CompressorDeviceBox, protectedEffect!: CompressorDeviceBox
    editing.modify(() => {
        copyable = CompressorDeviceBox.create(graph, UUID.generate(), box => box.host.refer(output.audioEffects))
        protectedEffect = CompressorDeviceBox.create(graph, UUID.generate(), box => {
            box.host.refer(output.audioEffects); box.index.setValue(1)
        })
    })
    Object.defineProperty(protectedEffect, "tags", {value: {...protectedEffect.tags, copyable: false}})
    const host = project.rootBoxAdapter.audioUnits.adapters().find(unit => unit.isOutput)!
    const selection = {selected: () => host.audioEffects.adapters()} as unknown as FilteredSelection<DeviceBoxAdapter>
    const devices = DevicesClipboard.createHandler({getEnabled: () => true, editing, selection, boxGraph: graph,
        boxAdapters: project.boxAdapters, getHost: () => Option.wrap(host)})
    devices.cut().unwrap()
    const cutPreserved = graph.findBox(protectedEffect.address.uuid).nonEmpty() && graph.findBox(copyable.address.uuid).isEmpty()
    editing.undo(); editing.redo(); editing.undo()
    const audio = AudioUnitsClipboard.createHandler({getEnabled: () => true, editing, boxGraph: graph,
        rootBoxAdapter: project.rootBoxAdapter, getEditedAudioUnit: () => Option.wrap(host),
        audioUnitEditing: {} as AudioUnitsClipboard.Context["audioUnitEditing"]})
    const entry = audio.copy().unwrap()
    const snapshot = () => graph.boxes().map(box => [UUID.toString(box.address.uuid), box.toJSON()])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    const before = JSON.stringify(snapshot())
    const original = graph.createBox.bind(graph)
    let count = 0, refused = false
    graph.createBox = ((...args: Parameters<typeof original>) => {
        if (++count === 2) {throw new Error("Synthetic install refusal")}
        return original(...args)
    }) as typeof original
    try {audio.paste(entry)} catch {refused = true} finally {graph.createBox = original}
    const restored = before === JSON.stringify(snapshot())
    project.terminate()
    return {cutPreserved, refused, restored}
}

export const recordingCancellation = async () => {
    const project = Project.new({} as ProjectEnv, {noDefaultUser: true})
    const preparation = Promise.withResolvers<{terminate(): void}>()
    let retired = 0, captures = 0, transports = 0
    project.captureDevices.filterArmed = () => [{prepareRecording: () => preparation.promise,
        startRecording: () => {captures++; return {terminate() {}}}, clearRecordedRegions() {},
        audioUnitBox: project.primaryAudioUnitBox}] as unknown as Capture[]
    project.engine.assertWorklet = () => {}
    project.engine.prepareRecordingState = () => {transports++}
    const original = Recording.start
    let pending!: ReturnType<typeof Recording.start>
    Recording.start = (...args) => pending = original.call(Recording, ...args)
    try {
        project.startRecording(false)
        project.stopRecording()
        preparation.resolve({terminate: () => {retired++}})
        await pending.catch(() => {})
        await Promise.resolve()
        return {retired, captures, transports, available: !Recording.isRecording}
    } finally {Recording.start = original; project.terminate()}
}

export const monitorOwnership = async () => {
    const context = new AudioContext()
    const source = context.createMediaStreamDestination()
    const originalRequest = AudioDevices.requestStream
    AudioDevices.requestStream = async () => source.stream
    const sinks = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const plays = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const elements: HTMLAudioElement[] = []
    const originalSink = HTMLMediaElement.prototype.setSinkId
    const originalPlay = HTMLMediaElement.prototype.play
    const originalPause = HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.setSinkId = function () {
        elements.push(this as HTMLAudioElement)
        return sinks[elements.length - 1].promise
    }
    HTMLMediaElement.prototype.play = function () {return plays[elements.indexOf(this as HTMLAudioElement)].promise}
    HTMLMediaElement.prototype.pause = () => {}
    const {boxGraph, mandatoryBoxes: {primaryAudioUnitBox}} = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    boxGraph.beginTransaction()
    const box = CaptureAudioBox.create(boxGraph, UUID.generate())
    primaryAudioUnitBox.capture.refer(box)
    boxGraph.endTransaction()
    const capture = new CaptureAudio({project: {env: {audioContext: context}}} as CaptureDevices, primaryAudioUnitBox, box)
    try {
        capture.monitoringMode = "direct"
        for (let i = 0; i < 30 && capture.stream.isEmpty(); i++) {await new Promise(resolve => setTimeout(resolve, 1))}
        const old = capture.setMonitorOutputDevice(Option.wrap("synthetic-old"))
        sinks[0].resolve(); await Promise.resolve()
        const current = capture.setMonitorOutputDevice(Option.wrap("synthetic-new"))
        sinks[1].resolve(); await Promise.resolve()
        plays[1].resolve(); await current
        plays[0].reject(new Error("Synthetic old sink refusal")); await old
        return {latest: capture.monitorOutputDeviceId.unwrap(), oldRetired: elements[0].srcObject === null,
            currentInstalled: elements[1].srcObject instanceof MediaStream}
    } finally {
        capture.terminate(); await context.close()
        AudioDevices.requestStream = originalRequest
        HTMLMediaElement.prototype.setSinkId = originalSink
        HTMLMediaElement.prototype.play = originalPlay
        HTMLMediaElement.prototype.pause = originalPause
    }
}
