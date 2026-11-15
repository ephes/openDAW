import {beforeAll, expect, it, vi} from "vitest"
import {MIDIOutputBox, MIDIOutputDeviceBox} from "@opendaw/studio-boxes"
import {MIDIOutputDeviceBoxAdapter} from "@opendaw/studio-adapters"
import {SetMultimap, UUID} from "@opendaw/lib-std"
import {MIDIOutputDeviceProcessor} from "../instruments/MIDIOutputDeviceProcessor"
import {NoteLifecycleEvent} from "../../NoteEventSource"
import {BlockFlag} from "../../processing"
import {block, outputNote, ScriptBlock, ScriptEvent, eventSource} from "../script-test-fixture"
import {spielFixture} from "./spielwerk-test-fixture"

beforeAll(() => {Object.assign(globalThis, {sampleRate: 48000})})
it("offers actual tempo and partial sample bounds through the EventProcessor to MIDI chain", () => {
    const seen: ScriptBlock[] = []
    const f = spielFixture(class {
        *process(b: ScriptBlock) {seen.push({...b}); yield outputNote(b.from, 1)}
    })
    const out = f.edit(() => MIDIOutputBox.create(f.graph, UUID.generate()))
    const box = f.edit(() => MIDIOutputDeviceBox.create(f.graph, UUID.generate(), b => b.device.refer(out.device)))
    const sink = new MIDIOutputDeviceProcessor(f.context, f.adapters.adapterFor(box, MIDIOutputDeviceBoxAdapter))
    sink.setNoteEventSource(f.processor)
    for (const b of [{...block(), s0: 7, s1: 31, bpm: 90}, {...block(10, 20), s0: 31, s1: 109, bpm: 147}]) {
        f.processor.process({blocks: [b]})
        sink.process({blocks: [b]})
    }
    expect(seen.map(b => [b.from, b.to, b.bpm, b.s0, b.s1])).toEqual([[0, 10, 90, 7, 31], [10, 20, 147, 31, 109]])
    expect(f.midi.length).toBeGreaterThan(0)
})

it.each([
    {position: Infinity}, {position: NaN}, {duration: Infinity}, {duration: NaN},
    {position: Number.MAX_VALUE, duration: Number.MAX_VALUE},
    {position: 1e30, duration: 1}, {pitch: 60.5}, {pitch: NaN},
    {velocity: Infinity}, {cent: Infinity}, {cent: NaN}, {cent: "10"}
])("refuses nonrepresentable note fields %j before retention", invalid => {
    const f = spielFixture(class {*process() {yield {...outputNote(), ...invalid}}})
    expect([...f.processor.processNotes(0, 10, 0)]).toEqual([])
    expect([...f.processor.iterateActiveNotesAt(0, false)]).toEqual([])
    expect(f.messages).toHaveLength(1)
    expect([...f.processor.processNotes(10, Number.MAX_VALUE, 0)]).toEqual([])
})
it("admits integral edge pitches, finite cents and optional default cents", () => {
    const f = spielFixture(class {*process() {
        yield {...outputNote(0, 1, 0), velocity: 0, cent: -1200}
        yield {...outputNote(0, 1, 127), velocity: 1, cent: undefined}
    }})
    const starts = [...f.processor.processNotes(0, 10, 0)].filter(NoteLifecycleEvent.isStart)
    expect(f.messages).toEqual([])
    expect(starts).toHaveLength(2)
})

it("cancels queued source descendants, preserves unrelated/anonymous notes, and owns due descendants", () => {
    const a = NoteLifecycleEvent.start(0, 100, 60, 1, 0)
    const b = NoteLifecycleEvent.start(0, 100, 64, 1, 0)
    const f = spielFixture(class {
        *process(context: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) {
                if (event.gate) yield outputNote(30, 100, event.pitch)
            }
            if (context.from === 0) yield outputNote(30, 100, 72)
        }
    })
    f.sourceLease.terminate()
    f.processor.setNoteEventSource(eventSource([a, b, NoteLifecycleEvent.stop(a, 10), NoteLifecycleEvent.stop(b, 40)]))
    expect([...f.processor.processNotes(0, 10, 0)]).toEqual([])
    expect([...f.processor.processNotes(10, 20, 0)]).toEqual([])
    const due = [...f.processor.processNotes(30, 40, 0)]
    expect(due.filter(NoteLifecycleEvent.isStart).map(e => e.pitch).sort()).toEqual([64, 72])
    const stops = [...f.processor.processNotes(40, 50, 0)]
    expect(stops.filter(NoteLifecycleEvent.isStop).map(e => e.pitch)).toEqual([64])
    expect([...f.processor.iterateActiveNotesAt(50, false)].map(e => e.pitch)).toEqual([72])
})
it.each(["seek", "stop"])("clears pending-only output on %s and calls reset once", action => {
    let resets = 0
    const f = spielFixture(class {
        *process(b: ScriptBlock) {if (b.from === 10) yield outputNote(50, 10)}
        reset() {resets++}
    })
    const playing = BlockFlag.transporting | BlockFlag.playing
    expect([...f.processor.processNotes(10, 20, playing)]).toEqual([])
    const flags = action === "seek" ? playing | BlockFlag.discontinuous : 0
    expect([...f.processor.processNotes(0, 10, flags)]).toEqual([])
    expect([...f.processor.processNotes(50, 60, playing)]).toEqual([])
    expect(resets).toBe(1)
})
it("quarantines a throwing reset hook without escaping the chain", () => {
    const f = spielFixture(class {
        *process() {yield outputNote(50, 10)}
        reset() {throw new Error("reset")}
    })
    Array.from(f.processor.processNotes(0, 10, 0))
    expect(() => [...f.processor.processNotes(10, 20, BlockFlag.discontinuous)]).not.toThrow()
    expect(f.messages).toHaveLength(1)
    expect([...f.processor.processNotes(50, 60, 0)]).toEqual([])
})
it("keeps scheduled starts before a same-window source stop and clips newly generated descendants", () => {
    const a = NoteLifecycleEvent.start(0, 100, 60, 1, 0)
    const f = spielFixture(class {
        *process(_b: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) if (event.gate) yield outputNote(15, 100)
        }
    })
    f.sourceLease.terminate()
    f.processor.setNoteEventSource(eventSource([a, NoteLifecycleEvent.stop(a, 18)]))
    expect([...f.processor.processNotes(0, 10, 0)]).toEqual([])
    const next = [...f.processor.processNotes(10, 20, 0)]
    expect(next.filter(NoteLifecycleEvent.isStart).map(e => e.position)).toEqual([15])
    expect(next.filter(NoteLifecycleEvent.isStop).map(e => e.position)).toEqual([18])
    const g = spielFixture(class {
        *process(_b: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) if (event.gate) {
                yield outputNote(1, 100)
                yield outputNote(30, 100)
            }
        }
    })
    g.sourceLease.terminate()
    g.processor.setNoteEventSource(eventSource([a, NoteLifecycleEvent.stop(a, 5)]))
    const same = [...g.processor.processNotes(0, 10, 0)]
    expect(same.filter(NoteLifecycleEvent.isStop).map(e => e.position)).toEqual([5])
    expect([...g.processor.processNotes(30, 40, 0)]).toEqual([])
})

it("retires expired reverse mappings during a long held source", () => {
    const source = NoteLifecycleEvent.start(0, 100000, 60, 1, 0)
    const f = spielFixture(class {
        *process(b: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) if (event.gate) yield outputNote(b.from, 1)
        }
    })
    f.sourceLease.terminate()
    f.processor.setNoteEventSource({
        *processNotes() {yield source}, *iterateActiveNotesAt() {}
    })
    const additions = vi.spyOn(SetMultimap.prototype, "add")
    let index: SetMultimap<number, number> | undefined
    try {
        for (let i = 0; i < 2000; i++) {
            const events = [...f.processor.processNotes(i * 10, i * 10 + 10, 0)]
            expect(events.filter(NoteLifecycleEvent.isStart)).toHaveLength(1)
            index ??= additions.mock.instances[0] as unknown as SetMultimap<number, number>
            expect(index.get(source.id).size).toBe(0)
            expect([...f.processor.iterateActiveNotesAt(i * 10 + 2, false)]).toEqual([])
        }
    } finally {additions.mockRestore()}
})
it.each(["throw", "flood", "invalid"])("balances active output exactly once on %s", kind => {
    const f = spielFixture(class {
        *process() {
            yield outputNote(2, 10000)
            if (kind === "throw") throw new Error("after start")
            if (kind === "invalid") yield {...outputNote(), cent: Infinity}
            else for (let i = 0; i < 129; i++) yield outputNote(3, 10000, 64)
        }
    })
    const events = [...f.processor.processNotes(0, 10, 0)]
    const starts = events.filter(NoteLifecycleEvent.isStart), stops = events.filter(NoteLifecycleEvent.isStop)
    expect(starts.length).toBeGreaterThan(0)
    expect(stops.map(e => e.id).sort()).toEqual(starts.map(e => e.id).sort())
    for (const stop of stops) expect(stop.position).toBeGreaterThanOrEqual(starts.find(s => s.id === stop.id)!.position)
    expect([...f.processor.iterateActiveNotesAt(5, false)]).toEqual([])
    expect([...f.processor.processNotes(10, 20, 0)]).toEqual([])
    expect(f.messages).toHaveLength(1)
})
it("drains parameter-fault output before constructing a replacement generation", () => {
    let armed = false, constructed = 0
    const f = spielFixture(class {
        *process() {yield outputNote(0, 10000)}
        paramChanged() {if (armed) throw new Error("parameter")}
    })
    const start = [...f.processor.processNotes(0, 10, 0)].find(NoteLifecycleEvent.isStart)!
    armed = true
    f.edit(() => f.param.value.setValue(0.5))
    f.compile(class {
        constructor() {constructed++}
        *process(b: ScriptBlock) {yield outputNote(b.from, 100, 64)}
    })
    expect(constructed).toBe(0)
    const next = [...f.processor.processNotes(10, 20, 0)]
    expect(NoteLifecycleEvent.isStop(next[0])).toBe(true)
    expect(next[0].id).toBe(start.id)
    expect(next.filter(NoteLifecycleEvent.isStop)).toHaveLength(1)
    expect(next.filter(NoteLifecycleEvent.isStart)).toHaveLength(1)
    expect(constructed).toBe(1)
})
it("honors a source stop before natural expiry in the same window", () => {
    const a = NoteLifecycleEvent.start(0, 100, 60, 1, 0)
    const f = spielFixture(class {
        *process(_b: ScriptBlock, events: Iterable<ScriptEvent>) {
            for (const event of events) if (event.gate) yield outputNote(0, 18)
        }
    })
    f.sourceLease.terminate()
    f.processor.setNoteEventSource(eventSource([a, NoteLifecycleEvent.stop(a, 15)]))
    Array.from(f.processor.processNotes(0, 10, 0))
    const events = [...f.processor.processNotes(10, 20, 0)]
    expect(events.filter(NoteLifecycleEvent.isStop).map(e => e.position)).toEqual([15])
})
