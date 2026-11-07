import {expect, it, vi} from "vitest"
import {AudioData} from "@opendaw/lib-dsp"
import {EngineContext} from "./EngineContext"
import {FrozenPlaybackProcessor} from "./FrozenPlaybackProcessor"
import {Block, BlockFlag} from "./processing"
const flags = BlockFlag.transporting | BlockFlag.playing
it.each([1, 2])("maps seeks using source rate, advances once, silences bounds and unregisters (%s channels)", channels => {
    const stop = vi.fn(), context = {registerProcessor: () => ({terminate: stop}),
        tempoMap: {intervalToSeconds: (_start: number, end: number) => end / 10}} as unknown as EngineContext
    const data = AudioData.create(10, 8, channels)
    data.frames.forEach((ch, c) => ch.set(Array.from({length: 8}, (_, i) => (i + 1) * (c ? -1 : 1))))
    const p = new FrozenPlaybackProcessor(context, data)
    const render = (p0: number, s1: number, extra = 0, active = flags) => {
        const block: Block = {index: 0, p0, p1: p0 + s1, s0: 0, s1, bpm: 120, flags: active | extra}
        p.process({blocks: [block]}); return Array.from(p.audioOutput.getChannel(0).slice(0, s1))
    }
    expect(render(2, 3)).toEqual([3, 4, 5])
    expect(render(999, 2)).toEqual([6, 7])
    expect(p.audioOutput.getChannel(1)[0]).toBe(channels === 1 ? 6 : -6)
    expect(render(-2, 4, BlockFlag.discontinuous)).toEqual([0, 0, 1, 2])
    expect(render(7, 4, BlockFlag.discontinuous)).toEqual([8, 0, 0, 0])
    expect(render(0, 4, 0, 0)).toEqual([0, 0, 0, 0])
    p.reset(); expect(Array.from(p.audioOutput.getChannel(0))).toEqual(Array(128).fill(0))
    expect(render(1, 2)).toEqual([2, 3]); p.terminate(); expect(stop).toHaveBeenCalledOnce()
})
