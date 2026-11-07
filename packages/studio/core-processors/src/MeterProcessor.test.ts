import {beforeAll, expect, it} from "vitest"
import {Schema, SyncStream} from "@opendaw/lib-std"
let Meter: typeof import("./MeterProcessor").MeterProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 1280, AudioWorkletProcessor: class {}}); Meter = (await import("./MeterProcessor")).MeterProcessor})
it.each(["dc", "silence", "alternating", "duty", "sine"])("publishes true RMS and separate channels for %s", kind => {
    const left = Float32Array.from({length: 128}, (_, i) => kind === "dc" ? 0.5 : kind === "silence" ? 0 : kind === "alternating" ? (i % 2 ? -0.5 : 0.5) : kind === "duty" ? (i < 64 ? 1 : 0) : Math.sin(2 * Math.PI * i / 32))
    const right = left.map(x => -x / 2)
    let levels = {peak: new Float32Array(2), rms: new Float32Array(2)}
    const reader = SyncStream.reader(Schema.createBuilder({peak: Schema.floats(2), rms: Schema.floats(2)})(), data => {
        levels = {peak: data.peak.slice(), rms: data.rms.slice()}
    })
    const meter = new Meter({processorOptions: {sab: reader.buffer, numberOfChannels: 2, rmsWindowInSeconds: 0.1, valueDecay: 0.5}})
    for (let i = 0; i < 4; i++) {expect(meter.process([[left, right]])).toBe(true); expect(reader.tryRead()).toBe(true)}
    const energy = left.reduce((sum, x) => sum + x * x, 0) / 128
    expect(levels.rms[0]).toBeCloseTo(Math.sqrt(energy), 6)
    expect(levels.rms[1]).toBeCloseTo(Math.sqrt(energy) / 2, 6)
    expect(levels.peak[0]).toBeCloseTo(Math.max(...left.map(Math.abs)), 6)
})
