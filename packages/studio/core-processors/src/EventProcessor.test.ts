import {expect, it} from "vitest"
import {Event} from "@opendaw/lib-dsp"
import {EngineContext} from "./EngineContext"
import {EventProcessor} from "./EventProcessor"
import {Block, BlockFlag} from "./processing"
class Recorder extends EventProcessor {
    readonly calls: unknown[][] = []
    handleEvent(_b: Block, e: Event): void {this.calls.push(["event", e.type, e.position])}
    processEvents(b: Block, from: number, to: number): void {this.calls.push(["process", from, to, b.flags])}
    updateParameters(p: number, time: number): void {this.calls.push(["update", p, time])}
    reset(): void {}
}
it("dispatches equal-time update/note events and covers each interval once with one-shot flags", () => {
    Object.assign(globalThis, {sampleRate: 1920})
    const r = new Recorder({} as EngineContext), persistent = BlockFlag.transporting | BlockFlag.playing
    for (const [type, position] of [["update-event", 0], ["note-a", 0], ["update-event", 32], ["note-b", 32], ["note-c", 32], ["note-end", 128]] as const)
        r.eventInput.add(0, {type, position})
    r.process({blocks: [{index: 0, p0: 0, p1: 128, s0: 0, s1: 128, bpm: 120, flags: persistent | BlockFlag.eventMask}]})
    expect(r.calls).toEqual([["update", 0, 0], ["event", "note-a", 0], ["process", 0, 32, persistent | BlockFlag.eventMask],
        ["update", 32, 32 / 1920], ["event", "note-b", 32], ["event", "note-c", 32], ["process", 32, 128, persistent], ["event", "note-end", 128]])
    expect(r.eventInput.get(0)).toEqual([])
})
