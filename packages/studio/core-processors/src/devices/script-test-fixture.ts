import {BoxGraph} from "@opendaw/lib-box"
import {BoxAdapters, BoxAdaptersContext, ParameterFieldAdapters} from "@opendaw/studio-adapters"
import {Terminable} from "@opendaw/lib-std"
import {EngineContext} from "../EngineContext"
import {Block, BlockFlag} from "../processing"
import {NoteEventSource, NoteLifecycleEvent} from "../NoteEventSource"

// Real boxes/adapters/processors; only worklet services and the hardware sink are synthetic.
export function deviceFixture() {
    const graph = new BoxGraph()
    const adapterContext = {boxGraph: graph, parameterFieldAdapters: new ParameterFieldAdapters(),
        isMainThread: false} as BoxAdaptersContext
    const adapters = new BoxAdapters(adapterContext)
    Object.assign(adapterContext, {boxAdapters: adapters})
    const messages: string[] = []
    const midi: Array<{id: string, data: number, time: number}> = []
    const context = {boxAdapters: adapters, registerProcessor: () => Terminable.Empty,
        broadcaster: {broadcastFloats: () => Terminable.Empty},
        audioOutputBufferRegistry: {register: () => Terminable.Empty},
        engineToClient: {deviceMessage: (_uuid: string, message: string) => messages.push(message)},
        sendMIDIData: (id: string, data: number, time: number) => midi.push({id, data, time})} as unknown as EngineContext
    const edit = <T>(action: () => T): T => {
        graph.beginTransaction()
        const result = action()
        graph.endTransaction()
        return result
    }
    return {graph, adapters, context, edit, messages, midi}
}
export const block = (p0 = 0, p1 = 10, flags = BlockFlag.transporting | BlockFlag.playing): Block =>
    ({index: 0, p0, p1, s0: 0, s1: 128, bpm: 120, flags})
export function eventSource(events: NoteLifecycleEvent[]): NoteEventSource {
    return {
        *processNotes(from, to) {yield* events.filter(e => from <= e.position && e.position < to)},
        *iterateActiveNotesAt() {}
    }
}
