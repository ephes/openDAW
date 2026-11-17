import {describe, expect, it, vi} from "vitest"
import {BoxGraph} from "@opendaw/lib-box"
import {Observer, Option, UUID} from "@opendaw/lib-std"
import {SoundfontDeviceBox, SoundfontFileBox} from "@opendaw/studio-boxes"
import type {Preset, SoundFont2} from "soundfont2"
import {BoxAdaptersContext} from "../../BoxAdaptersContext"
import {SoundfontLoader} from "../../soundfont/SoundfontLoader"
import {SoundfontLoaderState} from "../../soundfont/SoundfontLoaderState"
import {SoundfontDeviceBoxAdapter} from "./SoundfontDeviceBoxAdapter"

class Loader implements SoundfontLoader {
    readonly uuid = UUID.generate()
    readonly observers = new Set<Observer<SoundfontLoaderState>>()
    readonly callbacks: Observer<SoundfontLoaderState>[] = []
    soundfont: Option<SoundFont2> = Option.None
    state: SoundfontLoaderState = {type: "idle"}
    invalidate = vi.fn()
    subscribe(observer: Observer<SoundfontLoaderState>) {
        this.callbacks.push(observer)
        this.observers.add(observer)
        return {terminate: () => {this.observers.delete(observer)}}
    }
    emit(state: SoundfontLoaderState) {
        this.state = state
        this.observers.forEach(observer => observer(state))
    }
}

const font = (name: string) => ({presets: [{header: {name}} as Preset, {header: {name: name + "2"}} as Preset]} as SoundFont2)
const fixture = () => {
    const graph = new BoxGraph()
    graph.beginTransaction()
    const firstFile = SoundfontFileBox.create(graph, UUID.generate())
    const secondFile = SoundfontFileBox.create(graph, UUID.generate())
    const first = new Loader(), second = new Loader()
    const box = SoundfontDeviceBox.create(graph, UUID.generate(), box => box.file.refer(firstFile))
    graph.endTransaction()
    const getOrCreate = vi.fn((uuid: UUID.Bytes) => UUID.equals(uuid, firstFile.address.uuid) ? first : second)
    const fileSubscription = vi.spyOn(box.file, "subscribe")
    const presetSubscription = vi.spyOn(box.presetIndex, "subscribe")
    const adapter = new SoundfontDeviceBoxAdapter({soundfontManager: {getOrCreate}} as unknown as BoxAdaptersContext, box)
    const change = (action: () => void) => {graph.beginTransaction(); action(); graph.endTransaction()}
    const retireFile = vi.spyOn(fileSubscription.mock.results[0].value, "terminate")
    const retirePreset = vi.spyOn(presetSubscription.mock.results[0].value, "terminate")
    return {graph, box, adapter, first, second, secondFile, getOrCreate, change, retireFile, retirePreset}
}

describe("soundfont loader ownership", () => {
    it.each(["cached", "clear", "pending"] as const)("retires pending A on transition to %s", transition => {
        const {box, adapter, first, second, secondFile, change} = fixture()
        const cached = font("B")
        if (transition === "cached") {second.soundfont = Option.wrap(cached)}
        change(() => transition === "clear" ? box.file.defer() : box.file.refer(secondFile))
        expect(first.observers.size).toBe(0)
        const preset = vi.fn(), soundfont = vi.fn()
        adapter.preset.subscribe(preset); adapter.soundfont.subscribe(soundfont)
        first.soundfont = Option.wrap(font("A"))
        for (const state of [{type: "loaded"}, {type: "error", reason: "late"}, {type: "idle"}] as const) {
            first.emit(state)
            first.callbacks.forEach(callback => callback(state))
        }
        expect(preset).not.toHaveBeenCalled()
        expect(soundfont).not.toHaveBeenCalled()
        expect(adapter.soundfont.unwrapOrNull()).toBe(transition === "cached" ? cached : null)
        if (transition === "pending") {
            second.soundfont = Option.wrap(cached)
            second.emit({type: "loaded"})
            expect(adapter.soundfont.unwrap()).toBe(cached)
            change(() => box.presetIndex.setValue(1))
            expect(adapter.preset.unwrap()).toBe(cached.presets[1])
        }
        adapter.terminate()
        expect(second.observers.size).toBe(0)
    })
    it("fences a pointer callback queued before retirement", () => {
        const {box, adapter, secondFile, getOrCreate, change} = fixture()
        const calls = getOrCreate.mock.calls.length
        change(() => {box.file.refer(secondFile); adapter.terminate()})
        expect(getOrCreate).toHaveBeenCalledTimes(calls)
    })
    it("retires pointer observers and makes late callbacks inert without retiring shared loaders", () => {
        const {box, adapter, first, second, secondFile, getOrCreate, change, retireFile, retirePreset} = fixture()
        const preset = vi.fn(), soundfont = vi.fn()
        adapter.preset.subscribe(preset); adapter.soundfont.subscribe(soundfont)
        adapter.terminate(); adapter.terminate()
        const calls = getOrCreate.mock.calls.length
        first.soundfont = Option.wrap(font("A"))
        first.callbacks.forEach(callback => callback({type: "loaded"}))
        change(() => {box.file.refer(secondFile); box.presetIndex.setValue(1)})
        expect(getOrCreate).toHaveBeenCalledTimes(calls)
        expect(first.observers.size).toBe(0)
        expect(second.observers.size).toBe(0)
        expect(preset).not.toHaveBeenCalled()
        expect(soundfont).not.toHaveBeenCalled()
        expect(first.invalidate).not.toHaveBeenCalled()
        expect(retireFile).toHaveBeenCalledTimes(1)
        expect(retirePreset).toHaveBeenCalledTimes(1)
    })
})
