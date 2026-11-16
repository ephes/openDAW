import {beforeAll, expect, it} from "vitest"
import {ClassicWaveform, PPQN} from "@opendaw/lib-dsp"
import {VaporisateurDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {VoicingMode} from "@opendaw/studio-enums"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {block, processorFixture} from "../processor-test-fixture"

let Vapor: typeof import("./VaporisateurDeviceProcessor").VaporisateurDeviceProcessor
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    Vapor = (await import("./VaporisateurDeviceProcessor")).VaporisateurDeviceProcessor
}, 30000)
function fixture() {
    const f = processorFixture(), enabled = f.field(true)
    Object.assign(f.context, {baseFrequency: 440})
    const oscillator = () => ({waveform: f.field(ClassicWaveform.sine), octave: f.field(0), tune: f.field(0), volume: f.field(0)})
    const p = new Vapor(f.context, {address: f.address, uuid: f.address.uuid, box: {enabled},
        audioUnitBoxAdapter: () => ({address: f.address}), namedParameter: {
            oscillators: [oscillator(), oscillator()], attack: f.field(0.001), decay: f.field(0.01),
            sustain: f.field(1), release: f.field(0.005), cutoff: f.field(0.9), resonance: f.field(0.7),
            filterEnvelope: f.field(0), filterOrder: f.field(1), filterKeyboard: f.field(0), glideTime: f.field(0),
            voicingMode: f.field(VoicingMode.Polyphonic), unisonCount: f.field(1), unisonDetune: f.field(0),
            unisonStereo: f.field(0), lfoWaveform: f.field(ClassicWaveform.sine), lfoRate: f.field(1),
            lfoTargetTune: f.field(0), lfoTargetCutoff: f.field(0), lfoTargetVolume: f.field(0)
        }} as unknown as VaporisateurDeviceBoxAdapter)
    const events: NoteLifecycleEvent[] = []
    p.setNoteEventSource({*processNotes() {yield* events.splice(0)}, *iterateActiveNotesAt() {}})
    return {p, enabled, events}
}
it("refuses starts received while disabled, including an unmatched held note", () => {
    const {p, enabled, events} = fixture()
    enabled.setValue(false)
    const note = NoteLifecycleEvent.start(0, 1000, 60, 1)
    events.push(note); p.process({blocks: [block()]})
    events.push(NoteLifecycleEvent.stop(note, 0), NoteLifecycleEvent.start(0, 1000, 64, 1))
    p.process({blocks: [block()]}); p.process({blocks: [block()]})
    enabled.setValue(true); p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).every(x => x === 0)).toBe(true)
    events.push(NoteLifecycleEvent.start(0, 1000, 60, 1)); p.process({blocks: [block()]})
    expect(p.audioOutput.getChannel(0).some(x => Math.abs(x) > 0.001)).toBe(true)
    p.terminate()
})
it("clears a loud limiter history before a quiet restart over split blocks", () => {
    const warm = fixture(), fresh = fixture()
    warm.p.gainOscA = warm.p.gainOscB = 32
    warm.events.push(NoteLifecycleEvent.start(0, 1000, 60, 1))
    for (let i = 0; i < 40; i++) warm.p.process({blocks: [block()]})
    warm.p.reset()
    for (const {p, events} of [warm, fresh]) {
        p.gainOscA = p.gainOscB = 0.1
        events.push(NoteLifecycleEvent.start(0, 1000, 60, 0.25))
        p.process({blocks: [[0, 19], [19, 73], [73, 128]].map(([a, b], index) =>
            ({...block(a, b, PPQN.samplesToPulses(a, 120, sampleRate)), index}))})
    }
    expect(Array.from(warm.p.audioOutput.getChannel(0))).toEqual(Array.from(fresh.p.audioOutput.getChannel(0)))
    warm.p.terminate(); fresh.p.terminate()
})
