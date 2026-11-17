import {beforeAll, expect, it} from "vitest"
import {FoldDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {processorFixture, block} from "../processor-test-fixture"
import {upsampleReference, downsampleReference} from "../../../../../lib/dsp/src/resampler-test-fixture"
let Fold: typeof import("./FoldDeviceProcessor").FoldDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Fold = (await import("./FoldDeviceProcessor")).FoldDeviceProcessor})
function fixture(factor: number) {
    const f = processorFixture(), drive = f.field(0), volume = f.field(0)
    const p = new Fold(f.context, {address: f.address, uuid: f.address.uuid,
        namedParameter: {drive, volume}, box: {overSampling: f.field(factor)}} as unknown as FoldDeviceBoxAdapter)
    p.setAudioSource(f.input)
    return {...f, p, drive, volume}
}
it.each([0, 1, 2])("reset matches a fresh processor including active ramps (oversampling index=%i)", factor => {
    const warm = fixture(factor), fresh = fixture(factor)
    warm.input.getChannel(0)[16] = 1; warm.input.getChannel(1)[16] = -0.5
    warm.p.processAudio(block(0, 17))
    warm.drive.setValue(12); warm.volume.setValue(-6)
    warm.p.processAudio(block(17, 24))
    fresh.drive.setValue(12); fresh.volume.setValue(-6)
    warm.p.reset(); warm.p.reset(); warm.input.clear()
    for (let q = 0; q < 4; q++) {
        if (q === 1) {
            warm.input.getChannel(0)[3] = fresh.input.getChannel(0)[3] = 1
            warm.input.getChannel(1)[3] = fresh.input.getChannel(1)[3] = -0.5
        } else {warm.input.clear(); fresh.input.clear()}
        for (const [s0, s1] of [[0, 7], [7, 31], [31, 128]]) {
            warm.p.processAudio(block(s0, s1)); fresh.p.processAudio(block(s0, s1))
            expect(warm.p.audioOutput.channels()).toEqual(fresh.p.audioOutput.channels())
        }
    }
    warm.p.terminate(); fresh.p.terminate()
})

it.each([2, 4, 8] as const)("Fold %ix matches direct FIR/folding reference across partitions", factor => {
    const source = Float32Array.from({length: 512}, (_, i) => i === 0 ? 1 : 0.7 * Math.sin(i * 0.31))
    const up = upsampleReference(source, factor)
    const folded = up.map(value => {
        const s = 0.25 * value + 0.25
        return 4 * (Math.abs(s - Math.floor(s + 0.5)) - 0.25)
    })
    const expected = downsampleReference(folded, factor)
    for (const boundaries of [[0, 128], [0, 1, 7, 38, 39, 94, 128]]) {
        const f = fixture(factor === 2 ? 0 : factor === 4 ? 1 : 2)
        for (let q = 0; q < 4; q++) {
            f.input.getChannel(0).set(source.subarray(q * 128, (q + 1) * 128))
            f.input.getChannel(1).set(f.input.getChannel(0).map(x => -x))
            for (let b = 1; b < boundaries.length; b++) f.p.processAudio(block(boundaries[b - 1], boundaries[b]))
            f.p.audioOutput.getChannel(0).forEach((value, i) => expect(value).toBeCloseTo(expected[q * 128 + i], 6))
            f.p.audioOutput.getChannel(1).forEach((value, i) => expect(value).toBeCloseTo(-expected[q * 128 + i], 6))
        }
        f.p.terminate()
    }
})
