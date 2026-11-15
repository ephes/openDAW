import {beforeAll, expect, it} from "vitest"
import {RevampDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {processorFixture, block} from "../processor-test-fixture"
let Revamp: typeof import("./RevampDeviceProcessor").RevampDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Revamp = (await import("./RevampDeviceProcessor")).RevampDeviceProcessor})
function fixture(active = "") {
    const f = processorFixture()
    const bands = Object.fromEntries(["highPass", "lowShelf", "lowBell", "midBell", "highBell", "highShelf", "lowPass"].map(name =>
        [name, {enabled: f.field(name === active), frequency: f.field(1000), q: f.field(20), gain: f.field(12), order: f.field(3)}]))
    const p = new Revamp(f.context, {address: f.address, uuid: f.address.uuid, spectrum: f.address.append(9),
        namedParameter: bands} as unknown as RevampDeviceBoxAdapter)
    p.setAudioSource(f.input)
    return {...f, bands, p}
}
it("clears published and internal FFT generations on reset, then analyses a new tone", () => {
    const {p, streams, input} = fixture()
    const spectrum = streams.find(s => s.values.length === 512)!
    spectrum.publish(true)
    const tone = () => {
        for (let q = 0; q < 8; q++) {
            input.channels().forEach(ch => ch.forEach((_, i) => ch[i] = Math.sin(2 * Math.PI * (q * 128 + i) / 32)))
            p.processAudio(block())
        }
        spectrum.publish(true)
        expect(Math.max(...spectrum.values)).toBeGreaterThan(0.1)
    }
    tone(); p.reset()
    expect(spectrum.values.every(x => x === 0)).toBe(true)
    spectrum.publish(true)
    expect(spectrum.values.every(x => x === 0)).toBe(true)
    // A partial window must not resurrect bins from the previous generation.
    input.clear(); p.processAudio(block()); spectrum.publish(true)
    expect(spectrum.values.every(x => x === 0)).toBe(true)
    p.reset(); tone(); p.terminate()
})
it.each(["lowBell", "highPass", "lowPass"])("retires %s history through a silent bypass interval", name => {
    const warm = fixture(name), fresh = fixture(name)
    warm.input.getChannel(0)[127] = 1; warm.input.getChannel(1)[127] = -0.5
    warm.p.processAudio(block())
    warm.bands[name].enabled.setValue(false); warm.input.clear()
    for (let q = 0; q < 30; q++) warm.p.processAudio(block())
    warm.bands[name].enabled.setValue(true)
    for (const [s0, s1] of [[0, 17], [17, 48], [48, 128]]) {
        warm.p.processAudio(block(s0, s1)); fresh.p.processAudio(block(s0, s1))
        expect(warm.p.audioOutput.channels()).toEqual(fresh.p.audioOutput.channels())
    }
    warm.input.getChannel(0)[3] = fresh.input.getChannel(0)[3] = 1
    warm.p.processAudio(block()); fresh.p.processAudio(block())
    expect(warm.p.audioOutput.channels()).toEqual(fresh.p.audioOutput.channels())
    warm.p.terminate(); fresh.p.terminate()
})
