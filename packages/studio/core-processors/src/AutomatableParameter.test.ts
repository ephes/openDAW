import {expect, it, vi} from "vitest"
import {Address} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AutomatableParameterFieldAdapter} from "@opendaw/studio-adapters"
import {EngineContext} from "./EngineContext"
import {AutomatableParameter} from "./AutomatableParameter"
function fixture() {
    const listeners = new Set<() => void>(), broadcasts = new Set<() => number>(), stop = vi.fn()
    const adapter = {address: Address.compose(UUID.generate()), getValue: () => 2,
        valueMapping: {x: (x: number) => x / 10}, valueAt: (position: number) => position,
        subscribe: (cb: () => void) => {listeners.add(cb); return {terminate: () => listeners.delete(cb)}}} as unknown as AutomatableParameterFieldAdapter<number>
    const context = {broadcaster: {broadcastFloat: (_address: Address, cb: () => number) => {
        broadcasts.add(cb); return {terminate: () => {stop(); broadcasts.delete(cb)}}
    }}} as unknown as EngineContext
    return {p: new AutomatableParameter(context, adapter), listeners, broadcasts, stop}
}
it.each([false, true])("disposes active automation and adapter listeners exactly once (stop first %s)", stopFirst => {
    const f = fixture(), notify = vi.fn(); f.p.subscribe(notify)
    f.p.onStartAutomation(); expect(f.broadcasts.size).toBe(1)
    expect(f.p.updateAutomation(7)).toBe(true)
    expect([...f.broadcasts][0]()).toBe(0.7)
    if (stopFirst) {f.p.onStopAutomation(); expect(f.p.getValue()).toBe(2); expect(notify).toHaveBeenCalledOnce()}
    f.p.terminate(); f.p.terminate()
    expect(f.broadcasts.size).toBe(0); expect(f.listeners.size).toBe(0); expect(f.stop).toHaveBeenCalledOnce()
})
