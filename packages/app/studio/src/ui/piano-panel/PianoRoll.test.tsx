import {expect, it, vi} from "vitest"
import {DefaultObservableValue, Notifier, Option, Terminator} from "@opendaw/lib-std"
import {EventCollection} from "@opendaw/lib-dsp"
import {PianoRollLayout} from "@/ui/PianoRollLayout"
import {PianoRoll} from "./PianoRoll"

vi.mock("./PianoRoll.sass?inline", () => ({default: "component {}"}))
vi.hoisted(() => {
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("@opendaw/studio-adapters", () => ({NoteRegionBoxAdapter: class {}}))
import {NoteRegionBoxAdapter} from "@opendaw/studio-adapters"

function fixture(index = 0, offset = 0) {
    const lifecycle = new Terminator(), keyboard = new DefaultObservableValue(index)
    const position = new DefaultObservableValue(0), updateNotifier = new Notifier<void>()
    const events = EventCollection.create<{type: string, position: number, complete: number, pitch: number}>()
    events.add({type: "note-event", position: 0, complete: 10, pitch: 60}); events.add({type: "note-event", position: 20, complete: 30, pitch: 64})
    const region = Object.assign(Object.create(NoteRegionBoxAdapter.prototype), {position: 0, complete: 350,
        loopOffset: offset, loopDuration: 100, hue: 30, optCollection: Option.wrap({events, maxDuration: 10})})
    const project = {engine: {position}, rootBoxAdapter: {pianoMode: {keyboard, transpose: new DefaultObservableValue(0)},
        audioUnits: {adapters: () => [{tracks: {values: () => [{box: {excludePianoMode: {getValue: () => false}},
            regions: {collection: {lowerEqual: () => region}}}]}}]}}}
    const panel = PianoRoll({lifecycle, updateNotifier, service: {project}} as unknown as Parameters<typeof PianoRoll>[0])
    return {panel, keyboard, close: () => lifecycle.terminate(), seek: (value: number, pitch: number) => {
        position.setValue(value); updateNotifier.notify()
        return panel.querySelector(`[data-key="${pitch}"]`)!.classList.contains("playing")
    }}
}
it("lights exact onsets in repeated cycles and excludes completions", () => {
    const h = fixture()
    try {
        for (const cycle of [0, 100, 200]) {
            for (const [onset, pitch] of [[0, 60], [20, 64]]) {
                expect(h.seek(cycle + onset, pitch)).toBe(true)
                expect(h.seek(cycle + onset + 0.25, pitch)).toBe(true)
                expect(h.seek(cycle + onset + 10, pitch)).toBe(false)
            }
        }
        expect(h.seek(350, 60)).toBe(false)
    } finally {h.close()}
})
it("uses the containing cycle with an offset", () => {
    const h = fixture(0, 20)
    try {
        expect(h.seek(0, 64)).toBe(true); expect(h.seek(10, 64)).toBe(false)
        expect(h.seek(80, 60)).toBe(true); expect(h.seek(100, 64)).toBe(true)
    } finally {h.close()}
})
it.each([-1, 4, 1000])("recovers stored layout %s without rewriting it, including live changes", index => {
    const h = fixture(index)
    try {
        for (const next of [index, 0, 1, 2, 3, index]) {
            h.keyboard.setValue(next)
            expect(h.panel.querySelectorAll("rect")).toHaveLength(PianoRollLayout.getByIndex(next).count)
            expect(h.keyboard.getValue()).toBe(next)
            expect(h.seek(0, 60)).toBe(true)
        }
    } finally {h.close()}
})
