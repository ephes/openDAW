import {beforeAll, expect, it} from "vitest"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {PlayfieldDeviceProcessor} from "../PlayfieldDeviceProcessor"
import {processorFixture} from "../../processor-test-fixture"
let Mix: typeof import("./MixProcessor").MixProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Mix = (await import("./MixProcessor")).MixProcessor})
it("keeps duplicate and distinct attachments independently owned through repeated release and teardown", () => {
    const f = processorFixture()
    const p = new Mix(f.context, {uuid: f.address.uuid, adapter: {address: f.address}} as unknown as PlayfieldDeviceProcessor)
    const input = new AudioBuffer(), other = new AudioBuffer()
    input.channels().forEach(ch => ch.fill(0.25)); other.channels().forEach(ch => ch.fill(-0.125))
    const a = p.setAudioSource(input), b = p.setAudioSource(input), c = p.setAudioSource(other)
    const expectMix = (value: number) => {p.finishProcess(); expect(p.audioOutput.channels().every(ch => ch.every(x => x === value))).toBe(true)}
    expectMix(0.375)
    a.terminate(); a.terminate(); expectMix(0.125)
    c.terminate(); c.terminate(); expectMix(0.25)
    b.terminate(); b.terminate(); expectMix(0)
    p.setAudioSource(input); p.terminate(); p.finishProcess()
    expect(p.audioOutput.getChannel(0).every(x => x === 0)).toBe(true)
    a.terminate(); b.terminate()
})
