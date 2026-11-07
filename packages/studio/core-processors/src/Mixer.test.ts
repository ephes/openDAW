import {expect, it, vi} from "vitest"
import {Option, UUID} from "@opendaw/lib-std"
import {Mixer} from "./Mixer"
import {ChannelStripProcessor} from "./ChannelStripProcessor"
function channel() {
    const uuid = UUID.generate(), listeners = new Set<() => void>()
    const subscribe = (cb: () => void) => {listeners.add(cb); return {terminate: () => listeners.delete(cb)}}
    const inputs: Array<{box: {accept(visitor: {visitAudioUnitBox(box: unknown): unknown, visitAuxSendBox(box: unknown): unknown}): unknown}}> = []
    const input = {subscribe, adapter: () => Option.wrap({type: "bus", box: {input: {pointerHub: {filter: () => inputs}}}})}
    const output = {subscribe, adapter: Option.None as Option<{audioUnitBoxAdapter(): {uuid: UUID.Bytes}}>}
    const c = {isSolo: false, adapter: {uuid, input, output}, requestSoloUpdate: vi.fn()}
    return {c, processor: c as unknown as ChannelStripProcessor, inputs, output, listeners,
        connect: (upstream: {c: {adapter: {uuid: UUID.Bytes}}, output: typeof output}, aux = false) => {
            inputs.push({box: {accept: visitor => aux
                ? visitor.visitAuxSendBox({audioUnit: {targetVertex: Option.wrap({address: {uuid: upstream.c.adapter.uuid}})}})
                : visitor.visitAudioUnitBox({address: {uuid: upstream.c.adapter.uuid}})}})
            upstream.output.adapter = Option.wrap({audioUnitBoxAdapter: () => ({uuid})})
        }}
}
it("traverses buses, AuxSends and cycles, then recomputes and releases subscriptions", () => {
    const m = new Mixer(), a = channel(), b = channel(), bus = channel(), master = channel(), unrelated = channel()
    bus.connect(a); bus.connect(b, true); master.connect(bus)
    const all = [a, b, bus, master, unrelated], owners = all.map(x => m.attachChannelStrip(x.processor))
    const audible = () => all.filter(x => x.c.isSolo || m.isVirtualSolo(x.processor)).map(x => all.indexOf(x))
    a.c.isSolo = true; m.onChannelStripSoloChanged(a.processor); m.updateSolo(); expect(audible()).toEqual([0, 2, 3])
    a.c.isSolo = false; m.onChannelStripSoloChanged(a.processor); bus.c.isSolo = true; m.onChannelStripSoloChanged(bus.processor)
    m.updateSolo(); expect(audible()).toEqual([0, 1, 2, 3])
    // Back edge reaches the input cycle guard; the solo bus stops the output walk.
    a.connect(master); a.listeners.forEach(cb => cb()); m.updateSolo(); expect(audible()).toEqual([0, 1, 2, 3])
    bus.c.isSolo = false; m.onChannelStripSoloChanged(bus.processor); m.updateSolo(); expect(audible()).toEqual([])
    expect(m.hasChannelSolo()).toBe(false)
    bus.c.isSolo = true; m.onChannelStripSoloChanged(bus.processor); m.updateSolo()
    owners[2].terminate(); m.updateSolo()
    expect(m.hasChannelSolo()).toBe(false)
    all.filter(x => x !== bus).forEach(x => expect(m.isVirtualSolo(x.processor)).toBe(false))
    owners.forEach(owner => owner.terminate()); m.updateSolo()
    all.forEach(x => expect(x.listeners.size).toBe(0))
})

it("guards a downstream cycle made entirely of non-solo buses", () => {
    const mixer = new Mixer(), solo = channel(), y = channel(), z = channel()
    y.connect(solo); z.connect(y); y.connect(z)
    const owners = [solo, y, z].map(c => mixer.attachChannelStrip(c.processor))
    solo.c.isSolo = true; mixer.onChannelStripSoloChanged(solo.processor)
    expect(() => mixer.updateSolo()).not.toThrow()
    expect([y, z].map(c => mixer.isVirtualSolo(c.processor))).toEqual([true, true])
    owners.forEach(owner => owner.terminate())
})
