import {beforeAll, expect, it, vi} from "vitest"
import {PPQN, Fraction} from "@opendaw/lib-dsp"
import {TidalDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {processorFixture, block} from "../processor-test-fixture"
import {Block} from "../../processing"
let Tidal: typeof import("./TidalDeviceProcessor").TidalDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Tidal = (await import("./TidalDeviceProcessor")).TidalDeviceProcessor})
function fixture() {
    const f = processorFixture()
    const namedParameter = Object.fromEntries(Object.entries({rate: 16, depth: 0.9, slope: 0.3, symmetry: 0.4, offset: 27, channelOffset: 90}).map(([n, v]) => [n, f.field(v)]))
    const p = new Tidal(f.context, {address: f.address, uuid: f.address.uuid, namedParameter} as unknown as TidalDeviceBoxAdapter)
    f.input.getChannel(0).fill(1); f.input.getChannel(1).fill(0.25); p.setAudioSource(f.input)
    return {...f, p}
}
it.each([false, true])("matches real event-split rendering and phase (loop wrap=%s)", loop => {
    const whole = fixture(), split = fixture()
    const blocks: Block[] = loop ? [block(0, 48, 200), {...block(48, 128, 0), index: 1}] : [block(0, 128, 200)]
    const rendered: number[][] = []
    const original = split.p.processAudio.bind(split.p)
    vi.spyOn(split.p, "processAudio").mockImplementation(b => {rendered.push([b.s0, b.s1]); original(b)})
    blocks.forEach(b => {
        const cuts = loop ? (b.index === 0 ? [17] : [79]) : [17, 48]
        cuts.forEach(i => split.p.eventInput.add(b.index, {type: "update-event",
            position: b.p0 + PPQN.samplesToPulses(i - b.s0, b.bpm, sampleRate) + 1e-10}))
    })
    whole.p.process({blocks}); split.p.process({blocks})
    expect(rendered).toEqual(loop ? [[0, 17], [17, 48], [48, 79], [79, 128]] : [[0, 17], [17, 48], [48, 128]])
    whole.p.audioOutput.channels().forEach((ch, c) => ch.forEach((x, i) => expect(split.p.audioOutput.getChannel(c)[i]).toBeCloseTo(x, 7)))
    const last = blocks[blocks.length - 1]
    const expectedPhase = last.p1 / Fraction.toPPQN(TidalDeviceBoxAdapter.RateFractions[16])
    expect(whole.floats[0]()).toBeCloseTo(expectedPhase, 10)
    expect(split.floats[0]()).toBeCloseTo(expectedPhase, 10)
    whole.streams[0].publish(true); split.streams[0].publish(true)
    expect(split.streams[0].values[2]).toBeCloseTo(whole.streams[0].values[2], 7)
    expect(split.streams[0].values[3]).toBeCloseTo(whole.streams[0].values[3], 7)
    whole.p.terminate(); split.p.terminate()
})
