import {afterEach, beforeAll, expect, it, vi} from "vitest"
import {AudioData, EventCollection, FadingEnvelope, PPQN} from "@opendaw/lib-dsp"
import {Option, Terminable, UUID} from "@opendaw/lib-std"
import {AudioRegionBoxAdapter, TapeDeviceBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {TransientPlayMode} from "@opendaw/studio-enums"
import {block, processorFixture} from "../processor-test-fixture"
import {TimeStretchSequencer} from "./Tape/TimeStretchSequencer"
import {OnceVoice} from "./Tape/OnceVoice"
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
it.each([1000, 96000])("binds pitch voices to the current audio data generation (%i frames)", length => {
    const old = AudioData.create(sampleRate, length, 1); old.frames[0].fill(0.25)
    const {r, loader} = region(Option.wrap(old))
    const {p} = fixture([r])
    p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).some(x => x > 0)).toBe(true)
    const replacement = AudioData.create(sampleRate, length, 1); replacement.frames[0].fill(-0.5)
    loader.data = Option.wrap(replacement)
    p.process({blocks: [block(0, 128, pulses(128))]})
    expect(p.audioOutput.getChannel(0).every(x => x <= 0)).toBe(true)
    expect(p.audioOutput.getChannel(0)[127]).toBeLessThan(0)
    p.terminate()
})
it.each([false, true])("partitions fractional pitch cycles once with block-independent fades=%s", faded => {
    const render = (split: boolean) => {
        const {r} = region(Option.wrap(audio(1)))
        Object.defineProperty(r, "loopDuration", {value: pulses(17.25)})
        const fading = {hasFading: faded, in: faded ? pulses(64) : 0, out: 0, inSlope: 0.5, outSlope: 0.5}
        Object.defineProperty(r, "fading", {value: fading})
        const {p} = fixture([r])
        p.process({blocks: split ? [block(0, 29), block(29, 79, pulses(29)), block(79, 128, pulses(79))] : [block()]})
        const result = Array.from(p.audioOutput.getChannel(0))
        for (let i = 0; i < 128; i++) {
            const expected = FadingEnvelope.gainAt(pulses(i), r.duration, fading)
            expect(result[i], `frame=${i}, split=${split}`).toBeCloseTo(expected, 6)
        }
        p.terminate(); return result
    }
    const whole = render(false), split = render(true)
    split.forEach((x, i) => expect(x).toBeCloseTo(whole[i], 6))
})
it.each([false, true])("initializes every stretch gain frame for fractional cycles, faded=%s", faded => {
    const {r} = region(Option.wrap(audio(1)), true)
    Object.defineProperty(r, "loopDuration", {value: pulses(17.25)})
    const fading = {hasFading: faded, in: faded ? pulses(64) : 0, out: 0, inSlope: 0.5, outSlope: 0.5}
    Object.defineProperty(r, "fading", {value: fading})
    const original = OnceVoice.prototype.process
    const visits = new Uint8Array(128)
    vi.spyOn(OnceVoice.prototype, "process").mockImplementation(function(this: OnceVoice, start, count, gains) {
        for (let i = 0; i < count; i++) {
            visits[start + i]++
            expect(gains[i], `gain frame=${start + i}`).toBeCloseTo(FadingEnvelope.gainAt(pulses(start + i), r.duration, fading), 6)
        }
        original.call(this, start, count, gains)
    })
    const {p} = fixture([r])
    p.process({blocks: [block()]})
    expect(Array.from(visits)).toEqual(Array(128).fill(1))
    expect(p.audioOutput.channels().every(ch => ch.every(Number.isFinite))).toBe(true)
    p.terminate()
})
it("does not retire a pitch voice for a stretch interval quantized to zero frames", () => {
    const good = region(), tiny = region(Option.wrap(audio()), true)
    for (const [key, value] of Object.entries({position: pulses(17.2), complete: pulses(17.4),
        duration: pulses(0.2), loopDuration: pulses(0.2)})) Object.defineProperty(tiny.r, key, {value})
    const {p} = fixture([good.r, tiny.r])
    p.process({blocks: [block()]})
    expect(Array.from(p.audioOutput.getChannel(0))).toEqual(Array(128).fill(0.25))
    p.terminate()
})
