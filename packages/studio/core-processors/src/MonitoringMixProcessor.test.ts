import {expect, it} from "vitest"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {Option} from "@opendaw/lib-std"
import {EngineContext} from "./EngineContext"
import {MonitoringMixProcessor} from "./MonitoringMixProcessor"
it("keeps replacement registrations alive after stale disposal, even for the same buffer", () => {
    const l = new Float32Array(128).fill(1), r = new Float32Array(128).fill(2)
    const context = {getMonitoringChannel: (i: number) => Option.wrap(i === 0 ? l : i === 1 ? r : null)} as unknown as EngineContext
    const s = new MonitoringMixProcessor(context), a = new AudioBuffer(), b = new AudioBuffer()
    s.setChannels([0, 1]); const old = s.setAudioSource(a), current = s.setAudioSource(b)
    old.terminate(); old.terminate(); s.process({blocks: []})
    expect(b.getChannel(0)[0]).toBe(1); expect(b.getChannel(1)[0]).toBe(2); expect(a.getChannel(0)[0]).toBe(0)
    current.terminate(); s.process({blocks: []}); expect(b.getChannel(0)[0]).toBe(1)
    const sameOld = s.setAudioSource(b), sameNew = s.setAudioSource(b)
    sameOld.terminate(); s.setChannels([0]); s.process({blocks: []})
    expect(b.getChannel(0)[0]).toBe(2); expect(b.getChannel(1)[0]).toBe(3)
    s.setChannels([0, 99]); s.process({blocks: []}); expect(b.getChannel(1)[0]).toBe(4)
    s.setChannels([99]); s.process({blocks: []}); expect(b.getChannel(0)[0]).toBe(3)
    sameNew.terminate(); expect(l[0]).toBe(1); expect(r[0]).toBe(2)
})
