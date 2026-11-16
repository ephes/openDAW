import {afterEach, beforeAll, expect, it, vi} from "vitest"
import {AudioData, EventCollection, PPQN} from "@opendaw/lib-dsp"
import {Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioRegionBoxAdapter, TapeDeviceBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {TransientPlayMode} from "@opendaw/studio-enums"
import {block, processorFixture} from "../processor-test-fixture"
import {TimeStretchSequencer} from "./Tape/TimeStretchSequencer"
import {PitchVoice} from "./Tape/PitchVoice"

let Tape: typeof import("./TapeDeviceProcessor").TapeDeviceProcessor
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    Tape = (await import("./TapeDeviceProcessor")).TapeDeviceProcessor
}, 30000)
afterEach(() => {vi.restoreAllMocks()})
const pulses = (samples: number) => PPQN.samplesToPulses(samples, 120, sampleRate)
const audio = (value = 0.25) => {
    const data = AudioData.create(sampleRate, sampleRate * 2, 1)
    data.frames[0].fill(value)
    return data
}
function region(data: Option<AudioData> = Option.wrap(audio()), stretch = false) {
    const transients = EventCollection.create<{type: string, position: number}>()
    for (const position of [0, 1]) transients.add({type: "transient", position})
    const warpMarkers = EventCollection.create<{type: string, position: number, seconds: number}>()
    for (const [position, seconds] of [[0, 0], [3840, 2]]) warpMarkers.add({type: "warp", position, seconds})
    const loader = {data}
    const r = Object.create(AudioRegionBoxAdapter.prototype)
    const properties = {uuid: UUID.generate(), mute: false, position: 0, complete: 3840, duration: 3840,
        loopOffset: 0, loopDuration: 3840, waveformOffset: {getValue: () => 0},
        file: {getOrCreateLoader: () => loader, transients}, fading: {hasFading: false},
        isPlayModeNoStretch: true, asPlayModePitchStretch: Option.None,
        asPlayModeTimeStretch: stretch ? Option.wrap({warpMarkers, transientPlayMode: TransientPlayMode.Once, playbackRate: 1}) : Option.None}
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(r, key, {value, writable: true})
    return {r: r as AudioRegionBoxAdapter, loader, transients}
}
function fixture(initial: AudioRegionBoxAdapter[]) {
    const f = processorFixture(), enabled = f.field(true), regions = [...initial]
    const track = {uuid: UUID.generate(), type: TrackType.Audio, enabled,
        regions: {collection: {iterateRange: () => regions}}}
    Object.assign(f.context, {tempoMap: {intervalToSeconds: (a: number, b: number) => PPQN.pulsesToSeconds(b - a, 120)},
        clipSequencing: {iterate: (_uuid: UUID.Bytes, p0: number, p1: number) => [{optClip: Option.None, sectionFrom: p0, sectionTo: p1}]}})
    const p = new Tape(f.context, {address: f.address, uuid: f.address.uuid, box: {enabled: f.field(true)},
        deviceHost: () => ({audioUnitBoxAdapter: () => ({tracks: {
            catchupAndSubscribe: (observer: {onAdd: (t: typeof track) => void}) => {
                observer.onAdd(track); return Terminable.Empty
            }}})})} as unknown as TapeDeviceBoxAdapter)
    return {p, enabled, regions}
}
it.each(["unloaded", "insufficient transients"])("isolates an %s region in either collection order", kind => {
    const bad = region(kind === "unloaded" ? Option.None : Option.wrap(audio()), kind !== "unloaded")
    if (kind !== "unloaded") bad.transients.clear()
    const good = region()
    const results = []
    for (const regions of [[bad.r, good.r], [good.r, bad.r], [good.r]]) {
        const {p} = fixture(regions)
        p.process({blocks: [block()]})
        results.push(Array.from(p.audioOutput.getChannel(0)))
        p.terminate()
    }
    expect(results[2].every(x => x === 0.25)).toBe(true)
    expect(results[0]).toEqual(results[2]); expect(results[1]).toEqual(results[2])
})
it.each([false, true])("discards disabled lane voices without frozen tails, stretch=%s", stretch => {
    const {r} = region(Option.wrap(audio()), stretch)
    const {p, enabled, regions} = fixture([r])
    const sequencers: TimeStretchSequencer[] = []
    const original = TimeStretchSequencer.prototype.process
    vi.spyOn(TimeStretchSequencer.prototype, "process").mockImplementation(function(this: TimeStretchSequencer, ...args) {
        sequencers.push(this); return original.apply(this, args)
    })
    const pitchProcess = vi.spyOn(PitchVoice.prototype, "process")
    p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).some(x => x > 0)).toBe(true)
    enabled.setValue(false)
    for (let i = 0; i < 20; i++) p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).every(x => x === 0)).toBe(true)
    if (stretch) expect(sequencers[0].voiceCount).toBe(0)
    regions.length = 0; enabled.setValue(true); pitchProcess.mockClear()
    p.process({blocks: [block()]})
    expect(pitchProcess).not.toHaveBeenCalled()
    expect(p.audioOutput.getChannel(0).every(x => x === 0)).toBe(true)
    p.terminate()
})
