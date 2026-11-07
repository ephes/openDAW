import {beforeAll, expect, it, vi} from "vitest"
import {Address} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {LiveStreamBroadcaster} from "@opendaw/lib-fusion"
let Peak: typeof import("./PeakBroadcaster").PeakBroadcaster
beforeAll(async () => {Object.assign(globalThis, {sampleRate: 1280}); Peak = (await import("./PeakBroadcaster")).PeakBroadcaster})
it("clears all published values immediately and restarts like a fresh broadcaster", () => {
    const fixture = () => {
        let values: Float32Array, publish: (hasSubscribers: boolean) => void
        const terminate = vi.fn()
        const broadcaster = {broadcastFloats: (_address: Address, v: Float32Array, callback: typeof publish) => {
            values = v; publish = callback; return {terminate}
        }} as unknown as LiveStreamBroadcaster
        const peak = new Peak(broadcaster, Address.compose(UUID.generate()))
        return {peak, terminate, read: () => {publish(true); return Array.from(values)}}
    }
    const f = fixture(), fresh = fixture(), signal = new Float32Array(128).fill(0.5)
    f.peak.process(signal, signal); expect(f.read()).toEqual([0.5, 0.5, 0.5, 0.5])
    f.peak.clear(); f.peak.clear(); expect(f.read()).toEqual([0, 0, 0, 0])
    f.peak.process(signal, signal); fresh.peak.process(signal, signal); expect(f.read()).toEqual(fresh.read())
    f.peak.terminate(); expect(f.terminate).toHaveBeenCalledOnce()
})
