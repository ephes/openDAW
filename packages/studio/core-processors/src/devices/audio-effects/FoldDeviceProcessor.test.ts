import {beforeAll, expect, it} from "vitest"
import {FoldDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {processorFixture, block} from "../processor-test-fixture"
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
