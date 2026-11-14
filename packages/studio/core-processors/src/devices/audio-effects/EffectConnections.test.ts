import {beforeAll, expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Option, UUID} from "@opendaw/lib-std"
import {AudioEffectDeviceAdapter, GateDeviceBoxAdapter, StereoToolDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {Block} from "../../processing"

let Gate: typeof import("./GateDeviceProcessor").GateDeviceProcessor
let Stereo: typeof import("./StereoToolDeviceProcessor").StereoToolDeviceProcessor
let Nop: typeof import("./NopDeviceProcessor").NopDeviceProcessor
beforeAll(async () => {
    Object.assign(globalThis, {sampleRate: 48000})
    Gate = (await import("./GateDeviceProcessor")).GateDeviceProcessor
    Stereo = (await import("./StereoToolDeviceProcessor")).StereoToolDeviceProcessor
    Nop = (await import("./NopDeviceProcessor")).NopDeviceProcessor
})
const terminable = () => ({terminate() {}})
const block = (s0 = 0, s1 = 128): Block => ({index: 0, p0: 0, p1: 1, s0, s1, bpm: 120, flags: 0})
function fixture(kind: string) {
    const address = Address.compose(UUID.generate())
    const params = kind === "Gate" ? {inverse: false, threshold: -40, return: 6, attack: 0.5, hold: 50, release: 100, floor: 0}
        : {volume: 0, panning: 0, stereo: 0, invertL: false, invertR: false, swap: false}
    const namedParameter = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, {
        address, getValue: () => value, subscribe: terminable, valueMapping: {x: (x: number) => x},
        field: {pointerHub: {catchupAndSubscribe: terminable}}
    }]))
    const adapter = {address, uuid: address.uuid, namedParameter,
        sideChain: {catchupAndSubscribe: terminable, targetVertex: Option.None},
        box: {panningMixing: {catchupAndSubscribe: terminable}}}
    const context = {broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: {register: terminable}, subscribeProcessPhase: terminable} as unknown as EngineContext
    return kind === "Gate" ? new Gate(context, adapter as unknown as GateDeviceBoxAdapter)
        : kind === "Stereo" ? new Stereo(context, adapter as unknown as StereoToolDeviceBoxAdapter)
            : new Nop(context, adapter as unknown as AudioEffectDeviceAdapter)
}
function render(p: ReturnType<typeof fixture>, b = block()) {
    if (p instanceof Nop) p.process({blocks: [b]})
    else p.processAudio(b)
}
it.each(["Gate", "Stereo", "Nop"])("%s owns each source lease, including the same buffer", kind => {
    const p = fixture(kind), a = new AudioBuffer(), b = new AudioBuffer()
    a.channels().forEach(ch => ch.fill(0.1)); b.channels().forEach(ch => ch.fill(0.7))
    const old = p.setAudioSource(a), current = p.setAudioSource(b)
    old.terminate(); old.terminate(); render(p)
    expect(p.audioOutput.getChannel(0)[0]).toBeCloseTo(0.7)
    current.terminate(); current.terminate()
    const sameOld = p.setAudioSource(b), sameCurrent = p.setAudioSource(b)
    sameOld.terminate(); b.channels().forEach(ch => ch.fill(0.3)); render(p)
    expect(p.audioOutput.getChannel(0)[0]).toBeCloseTo(0.3)
    sameCurrent.terminate(); p.terminate()
})
it.each(["Gate", "Stereo", "Nop"])("%s silences only the disconnected output span and reconnects", kind => {
    const p = fixture(kind), input = new AudioBuffer()
    input.channels().forEach(ch => ch.fill(0.6))
    const lease = p.setAudioSource(input); render(p); lease.terminate()
    for (const [a, b] of [[7, 31], [31, 109]]) render(p, block(a, b))
    for (const ch of p.audioOutput.channels()) {
        if (kind !== "Nop") {
            expect(ch[6]).toBeCloseTo(0.6); expect(ch[109]).toBeCloseTo(0.6)
        }
        expect(ch.slice(7, 109)).toEqual(new Float32Array(102))
    }
    p.setAudioSource(input); render(p)
    expect(p.audioOutput.getChannel(0)[37]).toBeCloseTo(0.6)
    p.terminate()
})
