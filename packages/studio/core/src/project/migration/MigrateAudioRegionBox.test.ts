import {describe, expect, it} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Float, UUID} from "@opendaw/lib-std"
import {TimeBase} from "@opendaw/lib-dsp"
import {AudioFileBox, AudioRegionBox, BoxIO} from "@opendaw/studio-boxes"
import {AudioPlayback} from "@opendaw/studio-enums"
import {migrateAudioRegionBox} from "./MigrateAudioRegionBox"

const fixture = (timing = [5760, 480, 3840], span = [2, 10], playback = AudioPlayback.AudioFit) => {
    const graph = new BoxGraph<BoxIO.TypeMap>()
    graph.beginTransaction()
    const file = AudioFileBox.create(graph, UUID.generate(), box => {
        box.startInSeconds.setValue(span[0]); box.endInSeconds.setValue(span[1])
    })
    const region = AudioRegionBox.create(graph, UUID.generate(), box => {
        box.file.refer(file)
        box.duration.setValue(timing[0]); box.loopOffset.setValue(timing[1]); box.loopDuration.setValue(timing[2])
        box.playback.setValue(playback)
    })
    graph.endTransaction()
    return {graph, region}
}
const state = (region: AudioRegionBox) => [region.duration.getValue(), region.loopOffset.getValue(),
    region.loopDuration.getValue(), region.playback.getValue(), region.timeBase.getValue(), region.events.isEmpty()]

describe("AudioFit preflight", () => {
    it.each([
        {timing: [5760, 480, 0], span: [2, 10], bpm: 120},
        {timing: [5760, 480, 3840], span: [2, 2], bpm: 120},
        ...[0, -1, NaN, Infinity].map(bpm => ({timing: [5760, 480, 3840], span: [2, 10], bpm})),
        {timing: [Float.intBitsToFloat(5760), 480, 0], span: [2, 10], bpm: 120},
        {timing: [Infinity, 480, 3840], span: [2, 10], bpm: 120}
    ])("refuses invalid geometry without partial changes: %j", ({timing, span, bpm}) => {
        const {graph, region} = fixture(timing, span)
        const before = state(region)
        expect(() => migrateAudioRegionBox(graph, region, bpm)).toThrow("Invalid legacy AudioFit timing")
        expect(state(region)).toEqual(before)
        // No transaction was left open by refusal.
        graph.beginTransaction(); graph.endTransaction()
    })
    it("retains a nontrivial audible span and is idempotent", () => {
        const {graph, region} = fixture()
        migrateAudioRegionBox(graph, region, 135)
        expect(state(region).slice(0, 5)).toEqual([12, 1, 8, "", TimeBase.Seconds])
        const before = state(region)
        migrateAudioRegionBox(graph, region, 135)
        expect(state(region)).toEqual(before)
    })
})

describe("fieldwise legacy timing", () => {
    it.each(["mixed", "legacy", "modern"])("preserves %s values across two migrations", kind => {
        const normal = [5760, 480.5, 3840]
        const timing = kind === "modern" ? normal : kind === "legacy"
            ? [5760, 480, 3840].map(Float.intBitsToFloat) : [Float.intBitsToFloat(5760), 480.5, 3840]
        const {graph, region} = fixture(timing, [2, 10], "" as AudioPlayback)
        migrateAudioRegionBox(graph, region, 120)
        expect(state(region).slice(0, 3)).toEqual(kind === "legacy" ? [5760, 480, 3840] : normal)
        const before = state(region)
        migrateAudioRegionBox(graph, region, 120)
        expect(state(region)).toEqual(before)
    })
    it("refuses an encoded signature in seconds instead of guessing units", () => {
        const {graph, region} = fixture([Float.intBitsToFloat(5760), 1, 8], [2, 10], "" as AudioPlayback)
        graph.beginTransaction(); region.timeBase.setValue(TimeBase.Seconds); graph.endTransaction()
        const before = state(region)
        expect(() => migrateAudioRegionBox(graph, region, 120)).toThrow("Ambiguous legacy")
        expect(state(region)).toEqual(before)
    })
})


it("preserves modern seconds timing with a tiny normal float32 offset", () => {
    const {graph, region} = fixture([1.5, 1e-7, 2], [2, 10], "" as AudioPlayback)
    graph.beginTransaction(); region.timeBase.setValue(TimeBase.Seconds); graph.endTransaction()
    migrateAudioRegionBox(graph, region, 120)
    expect(state(region).slice(0, 5)).toEqual([1.5, Math.fround(1e-7), 2, "", TimeBase.Seconds])
    expect(region.events.nonEmpty()).toBe(true)
})
it("refuses AudioFit with modern seconds values without mutation", () => {
    const {graph, region} = fixture([1.5, 1, 2])
    graph.beginTransaction(); region.timeBase.setValue(TimeBase.Seconds); graph.endTransaction()
    const before = state(region)
    expect(() => migrateAudioRegionBox(graph, region, 120)).toThrow("Ambiguous legacy")
    expect(state(region)).toEqual(before)
})
