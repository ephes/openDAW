import {beforeAll, expect, it, vi} from "vitest"
import {Option, Terminable} from "@opendaw/lib-std"
import {Gate, PlayfieldSampleBoxAdapter} from "@opendaw/studio-adapters"
import {NoteLifecycleEvent} from "../../../NoteEventSource"
import {block, processorFixture} from "../../processor-test-fixture"
import {PlayfieldDeviceProcessor} from "../PlayfieldDeviceProcessor"
import {MixProcessor} from "./MixProcessor"

let Sample: typeof import("./SampleProcessor").SampleProcessor
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    Sample = (await import("./SampleProcessor")).SampleProcessor
}, 30000)
function fixture() {
    const f = processorFixture(), choke = vi.fn()
    Object.assign(f.context, {subscribeProcessPhase: () => Terminable.Empty})
    const polyphone = f.field(true), exclude = f.field(false)
    const p = new Sample(f.context, {hasSolo: () => false, stopExcludeOthers: choke} as unknown as PlayfieldDeviceProcessor,
        {address: f.address, uuid: f.address.uuid, peakAddress: f.address, gate: Gate.Loop,
            audioEffects: {catchupAndSubscribe: () => Terminable.Empty}, namedParameter: {
                sampleStart: f.field(0), sampleEnd: f.field(1), attack: f.field(1 / sampleRate),
                release: f.field(1 / sampleRate), pitch: f.field(0), mute: f.field(false), solo: f.field(false), polyphone, exclude},
            file: () => Option.wrap({getOrCreateLoader: () => ({data: Option.wrap({
                frames: [new Float32Array(4096).fill(1)], numberOfFrames: 4096, numberOfChannels: 1, sampleRate})})})
        } as unknown as PlayfieldSampleBoxAdapter, {} as MixProcessor)
    const stream = f.streams.find(x => x.values.length === 17)!
    const voiceCount = () => {
        stream.values.fill(-1); stream.publish(true)
        const end = stream.values.indexOf(-1)
        return end < 0 ? stream.values.length : end
    }
    return {p, voiceCount, choke, polyphone, exclude}
}
it("bounds live loops to 16, steals the oldest, and keeps surviving note-off ownership", () => {
    const {p, voiceCount} = fixture()
    const notes = Array.from({length: 100}, () => NoteLifecycleEvent.start(0, 1000, 60, 1))
    for (const note of notes) p.handleEvent(note)
    p.processAudio(block())
    expect(p.audioOutput.getChannel(0)[127]).toBe(16)
    expect(voiceCount()).toBe(16)
    // Stops for stolen notes cannot retire surviving retriggers of the same pitch.
    for (const note of notes.slice(0, -16)) p.handleEvent(NoteLifecycleEvent.stop(note, 0))
    p.processAudio(block()); expect(p.audioOutput.getChannel(0)[127]).toBe(16)
    for (const note of notes.slice(-16)) p.handleEvent(NoteLifecycleEvent.stop(note, 0))
    p.processAudio(block()); expect(voiceCount()).toBe(0)
    expect(p.audioOutput.channels().every(ch => ch.every(Number.isFinite))).toBe(true)
    p.terminate()
})
it("preserves choke dispatch and bounds monophonic release tails too", () => {
    const {p, voiceCount, choke, polyphone, exclude} = fixture()
    polyphone.setValue(false); exclude.setValue(true)
    for (let i = 0; i < 100; i++) p.handleEvent(NoteLifecycleEvent.start(0, 1000, 60, 1))
    expect(choke).toHaveBeenCalledTimes(100)
    p.processAudio(block()); expect(voiceCount()).toBeLessThanOrEqual(16)
    p.forceStop()
    p.processAudio(block()); p.processAudio(block()); p.processAudio(block())
    expect(voiceCount()).toBe(0)
    p.terminate()
})
