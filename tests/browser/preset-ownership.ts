import {Box, BoxEditing} from "@opendaw/lib-box"
import {Option, UUID} from "@opendaw/lib-std"
import {PPQN, TimeBase} from "@opendaw/lib-dsp"
import {AudioFileBox, DelayDeviceBox} from "@opendaw/studio-boxes"
import {Devices, InstrumentFactories, PresetEncoder, PresetHeader, RegionAdapters, Sample} from "@opendaw/studio-adapters"
import {AudioContentFactory, OpenPresetAPI, PresetEntry, PresetStorage, Project, ProjectEnv} from "@opendaw/studio-core"
import {PresetService} from "@/ui/browse/PresetService"
import {PresetApplication} from "@/ui/browse/PresetApplication"
import {PresetDialogs} from "@/ui/browse/PresetDialogs"
import type {StudioService} from "@/service/StudioService"

const check = (condition: boolean, message: string) => {if (!condition) {throw new Error(message)}}
const state = (boxes: ReadonlyArray<Box>) => JSON.stringify(boxes.map(box => ({
    uuid: UUID.toString(box.address.uuid), name: box.name, fields: [...new Uint8Array(box.toArrayBuffer())]
})).sort((a, b) => a.uuid.localeCompare(b.uuid)))
export const presetOwnership = async () => {
    const context = new AudioContext()
    const project = Project.new({audioContext: context, audioWorklets: {context}} as unknown as ProjectEnv)
    const editing = project.editing as BoxEditing
    let current: Project | null = project
    const service = {get project() {return current}, get optProject() {return Option.wrap(current)}} as StudioService
    const readIndex = PresetStorage.readIndex, getAPI = OpenPresetAPI.get, load = PresetApplication.loadBytes,
        save = PresetStorage.save, dialog = PresetDialogs.showSavePresetDialog
    try {
        Object.assign(PresetStorage, {readIndex: async () => []})
        OpenPresetAPI.get = () => ({list: async () => []}) as unknown as OpenPresetAPI
        const presets = new PresetService(service)
        const {audioUnitBox} = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap()
        const effect = project.editing.modify(() => DelayDeviceBox.create(project.boxGraph, UUID.generate(), box => {
            box.host.refer(audioUnitBox.audioEffects); box.label.setValue("Before")
        })).unwrap()
        const adapter = project.boxAdapters.adapterFor(effect, Devices.isAny)
        const entry = (name: string): PresetEntry => ({category: "audio-effect", device: "Delay", name,
            uuid: UUID.toString(UUID.generate()), source: "user", created: 0, modified: 0, description: ""})
        const before = state(project.boxGraph.boxes())
        editing.clear()
        Object.assign(PresetApplication, {loadBytes: async () => new ArrayBuffer(0)})
        await presets.applyPresetTo(adapter, entry("Corrupt"))
        check(state(project.boxGraph.boxes()) === before && !project.editing.canUndo(), "refused preset changed graph/history")
        const bytes = PresetEncoder.encodeEffects([effect], PresetHeader.ChainKind.Audio) as ArrayBuffer
        const a = Promise.withResolvers<ArrayBuffer>(), b = Promise.withResolvers<ArrayBuffer>()
        let calls = 0
        Object.assign(PresetApplication, {loadBytes: () => (++calls === 1 ? a.promise : b.promise)})
        const first = presets.applyPresetTo(adapter, entry("A")), selected = entry("B"), last = presets.applyPresetTo(adapter, selected)
        b.resolve(bytes); await last; a.resolve(bytes); await first
        const installed = audioUnitBox.audioEffects.pointerHub.incoming()[0].box as DelayDeviceBox
        const installedAdapter = project.boxAdapters.adapterFor(installed, Devices.isAny)
        check(presets.cursorFor(installedAdapter).unwrap() === `user:${selected.uuid}`, "stale load replaced latest cursor")
        check(project.editing.undo() && state(project.boxGraph.boxes()) === before, "preset undo did not restore source")
        const restored = project.boxGraph.findBox<DelayDeviceBox>(effect.address.uuid).unwrap()
        const confirm = Promise.withResolvers<Awaited<ReturnType<typeof PresetDialogs.showSavePresetDialog>>>()
        Object.assign(PresetDialogs, {showSavePresetDialog: () => confirm.promise})
        let saved = false
        Object.assign(PresetStorage, {save: async () => {saved = true}})
        const saving = presets.saveAsSingleEffectPreset("audio-effect", "Delay", restored)
        project.editing.modify(() => restored.label.setValue("Changed during dialog"))
        confirm.resolve({name: "Saved", description: "", includeTimeline: false}); await saving
        check(!saved, "changed source was saved")
        const late = Promise.withResolvers<ArrayBuffer>()
        Object.assign(PresetApplication, {loadBytes: () => late.promise})
        const pending = presets.applyPresetTo(project.boxAdapters.adapterFor(restored, Devices.isAny), entry("Late"))
        const leaving = state(project.boxGraph.boxes())
        current = null; late.resolve(bytes); await pending
        check(state(project.boxGraph.boxes()) === leaving, "closed project accepted preset")
    } finally {
        Object.assign(PresetStorage, {readIndex, save}); OpenPresetAPI.get = getAPI
        Object.assign(PresetApplication, {loadBytes: load}); Object.assign(PresetDialogs, {showSavePresetDialog: dialog})
        project.terminate(); await context.close()
    }
}

export const trackCompaction = async () => {
    const context = new AudioContext()
    const sampleManager = {register: () => ({terminate() {}}), getOrCreate: () => ({
        data: Option.None, peaks: Option.None, state: {type: "loading"}, subscribe: () => ({terminate() {}})
    })}
    const project = Project.new({audioContext: context, sampleManager, audioWorklets: {context}} as unknown as ProjectEnv)
    try {
        const {audioUnitBox, trackBox} = project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Tape)).unwrap()
        // Use two empty audio tracks to exercise real adapters/membership and undo.
        const second = project.editing.modify(() => project.api.createAudioTrack(audioUnitBox)).unwrap()
        const third = project.editing.modify(() => project.api.createAudioTrack(audioUnitBox)).unwrap()
        // ProjectApi's ordinary region factory creates the required owned graph.
        const sample = {uuid: UUID.toString(UUID.generate()), name: "synthetic", duration: 2, bpm: 0}
        // No sample loader is needed: the fixture never reads or plays media.
        project.editing.modify(() => {
            const file = AudioFileBox.create(project.boxGraph, UUID.parse(sample.uuid))
            const base = {boxGraph: project.boxGraph, sample: sample as Sample, audioFileBox: file}
            AudioContentFactory.createNotStretchedRegion({...base, targetTrack: trackBox, position: 0})
            AudioContentFactory.createNotStretchedRegion({...base, targetTrack: second, position: PPQN.Quarter})
            AudioContentFactory.createNotStretchedRegion({...base, targetTrack: third, position: project.tempoMap.secondsToPPQN(2)})
        })
        const regions = trackBox.regions.pointerHub.incoming().map(({box}) => RegionAdapters.for(project.boxAdapters, box))
        check(regions[0].isAudioRegion() && regions[0].box.timeBase.getValue() === TimeBase.Seconds, "fixture must use seconds")
        project.editing.modify(() => project.api.compactTracks(audioUnitBox))
        check(second.regions.pointerHub.incoming().length === 1, "overlapping audio moved into top lane")
        check(trackBox.regions.pointerHub.incoming().length === 2, "adjacent audio did not compact")
        check(project.editing.undo() && third.isAttached(), "compaction undo lost lane")
    } finally {project.terminate(); await context.close()}
}
