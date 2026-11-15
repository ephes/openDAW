import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import {ConstantTempoMap, PPQN, TempoMap, TimeBase} from "@opendaw/lib-dsp"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, TrackBox, ValueEventCollectionBox} from "@opendaw/studio-boxes"
import {AudioRegionBoxAdapter, BoxAdaptersContext, ProjectSkeleton, TrackType} from "@opendaw/studio-adapters"
import type {Project} from "./Project"
import {ProjectApi} from "./ProjectApi"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
afterEach(() => vi.restoreAllMocks())
type Span = [number, number, TimeBase?]
const fixture = (lanes: Span[][], tempoMap: TempoMap = new ConstantTempoMap(new DefaultObservableValue(120))) => {
    const {boxGraph: graph, mandatoryBoxes} = ProjectSkeleton.empty({createOutputMaximizer: false, createDefaultUser: false})
    const editing = new BoxEditing(graph)
    const unit = editing.modify(() => AudioUnitBox.create(graph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))).unwrap()
    const tracks = lanes.map((_, index) => editing.modify(() => TrackBox.create(graph, UUID.generate(), box => {
        box.tracks.refer(unit.tracks); box.target.refer(unit); box.type.setValue(TrackType.Audio); box.index.setValue(index)
    })).unwrap())
    const regions = lanes.map((spans, index) => spans.map(([position, duration, timeBase = TimeBase.Musical]) =>
        editing.modify(() => {
            const file = AudioFileBox.create(graph, UUID.generate())
            const events = ValueEventCollectionBox.create(graph, UUID.generate())
            return AudioRegionBox.create(graph, UUID.generate(), box => {
                box.events.refer(events.owners); box.file.refer(file); box.regions.refer(tracks[index].regions)
                box.position.setValue(position); box.duration.setValue(duration); box.timeBase.setValue(timeBase)
            })
        }).unwrap()))
    const trackAdapters = tracks.map(box => ({box, type: TrackType.Audio, indexField: box.index, regions: {onIndexingChanged() {}, dispatchChange() {}}}))
    const unitAdapter = {input: {adapter: () => ({isEmpty: () => false, unwrap: () => ({accepts: "audio"})})},
        tracks: {values: () => trackAdapters}, deleteTrack: (track: typeof trackAdapters[number]) => track.box.delete()}
    const cache = new Map<AudioRegionBox, AudioRegionBoxAdapter>()
    const context = {tempoMap, boxAdapters: {adapterFor: (box: AudioRegionBox | TrackBox | AudioUnitBox) => {
        if (box === unit) {return unitAdapter}
        if (box instanceof ValueEventCollectionBox) {return {subscribeChange: () => ({terminate() {}})}}
        if (box instanceof AudioFileBox) {return {getOrCreateLoader: () => ({subscribe: () => ({terminate() {}})})}}
        if (box instanceof TrackBox) {return trackAdapters[tracks.indexOf(box)]}
        const region = box as AudioRegionBox
        if (!cache.has(region)) {cache.set(region, new AudioRegionBoxAdapter(context as unknown as BoxAdaptersContext, region))}
        return cache.get(region)!
    }}}
    const project = {boxGraph: graph, boxAdapters: context.boxAdapters} as unknown as Project
    const api = new ProjectApi(project)
    const placement = () => regions.map(lane => lane.map(box => tracks.findIndex(track =>
        box.regions.targetAddress.unwrap().equals(track.regions.address))))
    const graphState = () => graph.boxes().map(box => ({uuid: UUID.toString(box.address.uuid), name: box.name,
        fields: new Uint8Array(box.toArrayBuffer())})).sort((a, b) => a.uuid.localeCompare(b.uuid))
    editing.clear()
    return {graph, graphState, editing, tracks, regions, placement, run: () => editing.modify(() => api.compactTracks(unit))}
}
it.each([60, 120, 240])("keeps overlapping seconds and beats on separate lanes at %i BPM", bpm => {
    const tempo = new ConstantTempoMap(new DefaultObservableValue(bpm))
    const f = fixture([[[0, 2, TimeBase.Seconds]], [[PPQN.Quarter / 2, 1]], [[tempo.secondsToPPQN(2), 1]]], tempo)
    const before = f.graphState()
    f.run()
    expect(f.placement()).toEqual([[0], [1], [0]])
    expect(f.editing.undo()).toBe(true)
    expect(f.graphState()).toEqual(before)
})
it("converts seconds across a tempo change using the region adapter", () => {
    // One second at 60 BPM, then 120 BPM. The two-second region ends at quarter 3.
    const q = PPQN.Quarter
    const secondsToPPQN = (s: number) => s <= 1 ? s * q : q + (s - 1) * 2 * q
    const ppqnToSeconds = (p: number) => p <= q ? p / q : 1 + (p - q) / (2 * q)
    const tempo = {secondsToPPQN, ppqnToSeconds,
        intervalToPPQN: (a: number, b: number) => secondsToPPQN(b) - secondsToPPQN(a),
        subscribe: () => ({terminate() {}})} as unknown as TempoMap
    const f = fixture([[[0, 2, TimeBase.Seconds]], [[q * 2, q / 2]], [[q * 3, 1]]], tempo)
    f.run()
    expect(f.placement()).toEqual([[0], [1], [0]])
})
it("matches greedy brute-force placement including initially overlapping intervals", () => {
    const lanes: Span[][] = [[[0, 4], [2, 1]], [[5, 2], [3, 1]], [[1, 2], [7, 2]], [[4, 1], [0, 8]]]
    // Independent identity-based oracle, preserving original candidate order.
    const occupied = lanes.map(lane => lane.map(([p, d]) => ({p, end: p + d})))
    const expected = occupied.map((lane, i) => [...lane].map(span => {
        for (let j = 0; j < i; j++) {
            if (occupied[j].every(other => other.p >= span.end || other.end <= span.p)) {
                occupied[j].push(span); occupied[i].splice(occupied[i].indexOf(span), 1); return j
            }
        }
        return i
    }))
    const f = fixture(lanes); f.run(); expect(f.placement()).toEqual(expected)
})
it("reads each region interval once for 1k/2k/4k moves instead of re-sorting prefixes", () => {
    const counts = [1000, 2000, 4000].map(n => {
        const f = fixture([[], Array.from({length: n}, (_, i) => [i * 2, 1] as Span)])
        let reads = 0
        for (const box of f.regions.flat()) {
            const get = box.position.getValue.bind(box.position)
            vi.spyOn(box.position, "getValue").mockImplementation(() => {reads++; return get()})
        }
        f.run()
        expect(f.placement()[1].every(index => index === 0)).toBe(true)
        expect(reads).toBeLessThan(n * 12)
        vi.restoreAllMocks()
        return reads
    })
    expect(counts[2]).toBeLessThanOrEqual(counts[0] * 4.5)
})
