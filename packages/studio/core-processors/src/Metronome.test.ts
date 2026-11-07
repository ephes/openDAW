import {beforeAll, expect, it} from "vitest"
import {AudioData, PPQN} from "@opendaw/lib-dsp"
import {EngineContext} from "./EngineContext"
import {Block, BlockFlag} from "./processing"
let Metronome: typeof import("./Metronome").Metronome
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 48000}); ({Metronome} = await import("./Metronome"))})
it.each([3, 4])("accents once per %s/4 measure for subdivisions 1/2/4 with adjacent ranges", nominator => {
    for (const subdivision of [1, 2, 4]) {
        // At this synthetic tempo a quarter note is 16 samples.
        const bpm = 180000
        const signature = {index: 0, accumulatedPpqn: 0, denominator: 4, nominator}
        const context = {timeInfo: {metronomeEnabled: true}, timelineBoxAdapter: {signatureTrack: {iterateAll: () => [signature]}},
            preferences: {settings: {metronome: {beatSubDivision: subdivision, gain: 0, monophonic: false}}}} as unknown as EngineContext
        const fixture = () => {
            const m = new Metronome(context)
            for (const index of [0, 1] as const) {const d = AudioData.create(48000, 2, 1); d.frames[0].fill(index === 0 ? 2 : 1); m.loadClickSound(index, d)}
            return m
        }
        const total = nominator * 16, make = (a: number, b: number): Block => ({index: 0, p0: a / 16 * PPQN.fromSignature(1, 4), p1: b / 16 * PPQN.fromSignature(1, 4), s0: a, s1: b, bpm, flags: BlockFlag.transporting})
        const whole = fixture(); whole.process({blocks: [make(0, total)]})
        const split = fixture(); split.process({blocks: [make(0, 16), make(16, total)]})
        expect(split.output.getChannel(0)).toEqual(whole.output.getChannel(0))
        const clicks = Array.from(whole.output.getChannel(0).slice(0, total)).filter(x => x !== 0)
        expect(clicks).toHaveLength(nominator * subdivision); expect(clicks.filter(x => x === 2)).toHaveLength(1)
        const positions = Array.from(whole.output.getChannel(0).slice(0, total)).flatMap((x, i) => x !== 0 ? [i] : [])
        expect(positions).toEqual(Array.from({length: nominator * subdivision}, (_, i) => i * 16 / subdivision))
    }
})
it("restarts the accent at a signature change without duplicating its boundary click", () => {
    const signatures = [{index: 0, accumulatedPpqn: 0, denominator: 4, nominator: 4},
        {index: 1, accumulatedPpqn: 3840, denominator: 4, nominator: 3}]
    const context = {timeInfo: {metronomeEnabled: true}, timelineBoxAdapter: {signatureTrack: {iterateAll: () => signatures}},
        preferences: {settings: {metronome: {beatSubDivision: 2, gain: 0, monophonic: false}}}} as unknown as EngineContext
    const m = new Metronome(context)
    for (const index of [0, 1] as const) {const d = AudioData.create(48000, 2, 1); d.frames[0].fill(index ? 1 : 2); m.loadClickSound(index, d)}
    m.process({blocks: [{index: 0, p0: 0, p1: 3840, s0: 0, s1: 64, bpm: 180000, flags: BlockFlag.transporting},
        {index: 1, p0: 3840, p1: 6720, s0: 64, s1: 112, bpm: 180000, flags: BlockFlag.transporting}]})
    const pcm = m.output.getChannel(0)
    expect(Array.from(pcm).flatMap((x, i) => x === 2 ? [i] : [])).toEqual([0, 64])
    expect(Array.from(pcm).filter(x => x !== 0)).toHaveLength(14)
})
