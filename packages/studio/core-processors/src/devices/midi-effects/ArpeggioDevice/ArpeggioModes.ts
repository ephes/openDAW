import {Id, int, unitValue} from "@opendaw/lib-std"
import {ppqn} from "@opendaw/lib-dsp"
import {ActiveNoteEvent, NoteLifecycleEvent} from "../../../NoteEventSource"

export type Stack = ReadonlyArray<Omit<ActiveNoteEvent, "position">>
export namespace Stack {
    export const PitchComparator = (a: Stack[number], b: Stack[number]): number => a.pitch - b.pitch || a.cent - b.cent
}
export type VelocityMatrix = { mult: unitValue, add: unitValue }
export namespace VelocityMatrix {
    export const create = (): VelocityMatrix => ({mult: 1.0, add: 0.0})
    export const apply = (matrix: VelocityMatrix, velocity: unitValue): unitValue => velocity * matrix.mult + matrix.add
}

export interface Mode {
    get name(): string
    run(stack: Stack, octaves: int, stepIndex: int, position: ppqn, duration: ppqn, velocityMatrix: VelocityMatrix): Id<ActiveNoteEvent>
}

export const ArpeggioModes: ReadonlyArray<Mode> = Object.freeze([{
    name: "up",
    run: (stack: Stack,
          octaves: int,
          stepIndex: int,
          position: ppqn,
          duration: ppqn,
          velocityMatrix: VelocityMatrix): Id<ActiveNoteEvent> => {
        const count = stack.length
        const amount = count * octaves
        const localIndex = stepIndex % count
        const octave = Math.floor((stepIndex % amount) / count)
        const event = stack[localIndex]
        return {...NoteLifecycleEvent.start(
            position, duration, event.pitch + octave * 12, VelocityMatrix.apply(velocityMatrix, event.velocity), event.cent),
            external: event.external}
    }
}, {
    name: "down",
    run: (stack: Stack,
          octaves: int,
          stepIndex: int,
          position: ppqn,
          duration: ppqn,
          velocityMatrix: VelocityMatrix): Id<ActiveNoteEvent> => {
        const count = stack.length
        const amount = count * octaves
        const localIndex = (count - 1) - stepIndex % count
        const octave = (octaves - 1) - Math.floor((stepIndex % amount) / count)
        const event = stack[localIndex]
        return {...NoteLifecycleEvent.start(
            position, duration, event.pitch + octave * 12, VelocityMatrix.apply(velocityMatrix, event.velocity), event.cent),
            external: event.external}
    }
}, {
    name: "up-down",
    run: (stack: Stack,
          octaves: int,
          stepIndex: int,
          position: ppqn,
          duration: ppqn,
          velocityMatrix: VelocityMatrix): Id<ActiveNoteEvent> => {
        const count = stack.length
        const processLength = count * octaves
        const sequenceLength = Math.max(1, processLength * 2 - 2)
        const sequenceIndex = stepIndex % sequenceLength
        const processIndex = (sequenceIndex < processLength ? sequenceIndex : sequenceLength - sequenceIndex)
        const localIndex = processIndex % count
        const octave = Math.floor(processIndex / count)
        const event = stack[localIndex]
        return {...NoteLifecycleEvent.start(
            position, duration, event.pitch + octave * 12, VelocityMatrix.apply(velocityMatrix, event.velocity), event.cent),
            external: event.external}
    }
}])