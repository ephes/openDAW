import {beforeAll, expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer, Mixing} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {StereoToolDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "../../EngineContext"
import {Block} from "../../processing"
let Stereo: typeof import("./StereoToolDeviceProcessor").StereoToolDeviceProcessor
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); Stereo = (await import("./StereoToolDeviceProcessor")).StereoToolDeviceProcessor})
const terminable = () => ({terminate() {}})
const block = (s0 = 0, s1 = 128): Block => ({index: 0, p0: 0, p1: 1, s0, s1, bpm: 120, flags: 0})
function fixture(mixing: Mixing) {
    const address = Address.compose(UUID.generate())
    const values: Record<string, number | boolean> = {volume: 0, panning: 0, stereo: 0, invertL: false, invertR: false, swap: false}
    const notify: Record<string, () => void> = {}
    const namedParameter = Object.fromEntries(Object.keys(values).map(name => {
        const field = {address, getValue: () => values[name],
            subscribe: (fn: (owner: {getValue(): number | boolean}) => void) => {notify[name] = () => fn(field); return terminable()},
            valueMapping: {x: (x: number) => x}, field: {pointerHub: {catchupAndSubscribe: terminable}}}
        return [name, field]
    }))
    const adapter = {address, uuid: address.uuid, namedParameter,
        box: {panningMixing: {catchupAndSubscribe: (fn: (field: {getValue(): Mixing}) => void) => {fn({getValue: () => mixing}); return terminable()}}}}
    const context = {broadcaster: {broadcastFloats: terminable}, registerProcessor: terminable,
        audioOutputBufferRegistry: {register: terminable}} as unknown as EngineContext
    const p = new Stereo(context, adapter as unknown as StereoToolDeviceBoxAdapter)
    const input = new AudioBuffer(); input.getChannel(0).fill(0.7); input.getChannel(1).fill(-0.2)
    p.setAudioSource(input)
    return {p, set: (params: typeof values) => {
        for (const [name, value] of Object.entries(params)) {values[name] = value; notify[name]()}
    }}
}
it.each([Mixing.Linear, Mixing.EqualPower])("reset snaps a partially processed matrix ramp (mixing=%s)", mixing => {
    const warm = fixture(mixing), fresh = fixture(mixing)
    warm.p.processAudio(block())
    const target = {volume: -12, panning: 0.9, stereo: -0.7, swap: true, invertL: true, invertR: true}
    warm.set(target); warm.p.processAudio(block(0, 17))
    fresh.set(target); warm.p.reset(); warm.p.reset()
    for (let q = 0; q < 3; q++) for (const [s, e] of [[0, 7], [7, 31], [31, 128]]) {
        warm.p.processAudio(block(s, e)); fresh.p.processAudio(block(s, e))
        warm.p.audioOutput.channels().forEach((ch, c) => expect(ch.slice(s, e)).toEqual(fresh.p.audioOutput.getChannel(c).slice(s, e)))
    }
    warm.p.terminate(); fresh.p.terminate()
})
