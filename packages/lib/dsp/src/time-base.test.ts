import {describe, expect, it} from "vitest"
import {DefaultObservableValue, Terminable} from "@opendaw/lib-std"
import {TimeBase, TimeBaseConverter} from "./time-base"
import {TempoMap} from "./tempo"

// 60 BPM until pulse1920/second2, then120 BPM. Durations are differences of these independent point maps.
const toSeconds = (pulse: number) => pulse <= 1920 ? pulse / 960 : 2 + (pulse - 1920) / 1920
const toPulses = (seconds: number) => seconds <= 2 ? seconds * 960 : 1920 + (seconds - 2) * 1920
const tempo: TempoMap = {
    subscribe: () => Terminable.Empty,
    getTempoAt: pulse => pulse < 1920 ? 60 : 120,
    ppqnToSeconds: toSeconds,
    secondsToPPQN: toPulses,
    intervalToSeconds: (from, to) => toSeconds(to) - toSeconds(from),
    intervalToPPQN: (from, to) => toPulses(to) - toPulses(from)
}
describe("TimeBaseConverter position-aware durations", () => {
    it("previews seconds durations at two positions across a tempo boundary", () => {
        const base = new DefaultObservableValue<string>(TimeBase.Seconds)
        const property = new DefaultObservableValue(1.5)
        const converter = TimeBaseConverter.aware(tempo, base, property)
        expect(converter.toPPQN(0)).toBe(1440)
        expect(converter.toPPQN(960)).toBe(1920)
        expect(converter.toSeconds(960)).toBe(1.5)
        expect(converter.toSamples(960, 8000)).toBe(12000)
        expect(converter.toSamples(960, 48000)).toBe(72000)
        expect(property.getValue()).toBe(1.5)
        expect(converter.rawValue()).toBe(1.5)
        expect(converter.getTimeBase()).toBe(TimeBase.Seconds)
    })
    it("roundtrips fromPPQN and reads live base/property changes", () => {
        const base = new DefaultObservableValue<string>(TimeBase.Seconds)
        const property = new DefaultObservableValue(0)
        const converter = TimeBaseConverter.aware(tempo, base, property)
        converter.fromPPQN(1920, 960)
        expect(property.getValue()).toBe(1.5)
        expect(converter.toPPQN(960)).toBe(1920)
        converter.fromPPQN(1920, 0)
        expect(property.getValue()).toBe(2)
        expect(converter.toPPQN(0)).toBe(1920)
        base.setValue(TimeBase.Musical)
        property.setValue(1920)
        expect(converter.toPPQN(960)).toBe(1920)
        expect(converter.toSeconds(0)).toBe(2)
        expect(converter.toSeconds(960)).toBe(1.5)
        expect(converter.toSamples(960, 8000)).toBe(12000)
        expect(property.getValue()).toBe(1920)
        converter.fromPPQN(480, 960)
        expect(property.getValue()).toBe(480)
        base.setValue(TimeBase.Seconds)
        property.setValue(0.25)
        expect(converter.toPPQN(1920)).toBe(480)
        expect(converter.getTimeBase()).toBe(TimeBase.Seconds)
    })
})
