import {beforeAll, expect, it} from "vitest"
import {AuxSendBoxAdapter} from "@opendaw/studio-adapters"
import {processorFixture, block} from "./devices/processor-test-fixture"
let AuxSend: typeof import("./AuxSendProcessor").AuxSendProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); AuxSend = (await import("./AuxSendProcessor")).AuxSendProcessor})
it("keeps disabled sends silent and restores their saved level when enabled", () => {
    const f = processorFixture()
    const enabled = f.field(false)
    const adapter = {address: f.address, uuid: f.address.uuid, enabledField: enabled, sendGain: f.field(-6), sendPan: f.field(0)} as unknown as AuxSendBoxAdapter
    const processor = new AuxSend(f.context, adapter)
    f.input.getChannel(0).fill(1)
    f.input.getChannel(1).fill(1)
    processor.setAudioSource(f.input)
    processor.processAudio(block())
    expect(processor.audioOutput.getChannel(0).every(value => value === 0)).toBe(true)
    enabled.setValue(true)
    for (let i = 0; i < 100; i++) {processor.processAudio(block())}
    expect(processor.audioOutput.getChannel(0)[127]).toBeCloseTo(10 ** (-6 / 20))
    enabled.setValue(false)
    for (let i = 0; i < 100; i++) {processor.processAudio(block())}
    expect(processor.audioOutput.getChannel(0)[127]).toBe(0)
    processor.terminate()
})
