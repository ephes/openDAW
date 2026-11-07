import {AudioBuffer} from "@opendaw/lib-dsp"
import {NoteLifecycleEvent} from "../NoteEventSource"
import {Block} from "../processing"
import {Voice} from "./Voice"
import {VoicingHost} from "./VoicingHost"
export const block: Block = {index: 0, p0: 0, p1: 1, s0: 0, s1: 128, bpm: 120, flags: 0}
export const note = (pitch: number) => NoteLifecycleEvent.start(0, 1, pitch, 1)
export class RecordingVoice implements Voice {
    id = -1; gate = true; currentFrequency = 0; done = false; amplitude = 1
    readonly calls: Array<unknown[]> = []
    start(event: ReturnType<typeof note>, frequency: number, gain: number, spread: number): void {
        this.id = event.id; this.currentFrequency = frequency
        this.calls.push(["start", event.id, frequency, gain, spread])
    }
    startGlide(frequency: number, time: number): void {this.calls.push(["glide", frequency, time]); this.currentFrequency = frequency}
    stop(): void {this.calls.push(["stop"]); this.gate = false}
    forceStop(): void {this.calls.push(["forceStop"]); this.gate = false}
    process(output: AudioBuffer, _block: Block, from: number, to: number): boolean {
        this.calls.push(["process", from, to])
        if (!this.done) output.channels().forEach(ch => {for (let i = from; i < to; i++) ch[i] += this.amplitude})
        return this.done
    }
}
export function host() {
    const voices: RecordingVoice[] = []
    const host: VoicingHost = {glideTime: 2, computeFrequency: n => n.pitch * 10,
        create: () => {const v = new RecordingVoice(); voices.push(v); return v}}
    return {host, voices}
}
