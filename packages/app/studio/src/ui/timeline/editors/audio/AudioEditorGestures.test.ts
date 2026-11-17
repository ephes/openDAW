import {afterEach, describe, expect, it, vi} from "vitest"
import {PPQN, TimeBase} from "@opendaw/lib-dsp"
import {audioGestureFixture, AudioGestureOwner} from "./AudioEditorGestures.test-fixture"

vi.hoisted(() => {globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode})
type Fixture = ReturnType<typeof audioGestureFixture>
const fixtures: Array<Fixture> = []
const create = (...args: Parameters<typeof audioGestureFixture>): Fixture => {
    const fixture = audioGestureFixture(...args)
    fixtures.push(fixture)
    return fixture
}
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.close()))

const gestures = [
    {gesture: "resize", start: PPQN.Bar, moves: [PPQN.Bar + PPQN.Quarter, PPQN.Bar + PPQN.Quarter * 2]},
    {gesture: "slip", start: PPQN.Quarter, moves: [PPQN.Quarter * 2, PPQN.Quarter * 3]}
] as const

describe.each<AudioGestureOwner>(["clip", "region"])("audio %s editor gestures", owner => {
    describe.each(gestures)("$gesture", ({gesture, start, moves}) => {
        const drag = (fixture: Fixture) => {
            const process = fixture.begin(gesture, start)
            moves.forEach(unit => process.update(fixture.at(unit)))
            return process
        }
        it("cancellation restores the provisional edit and leaves history intact", () => {
            const fixture = create(owner)
            const before = fixture.read()
            const process = drag(fixture)
            expect(fixture.read()).not.toEqual(before)
            process.cancel?.()
            expect(fixture.read()).toEqual(before)
            expect(fixture.editing.undo()).toBe(true)
            expect(fixture.read()).toEqual({...before, label: "before"})
        })
        it("approval commits one undoable edit", () => {
            const fixture = create(owner)
            const before = fixture.read()
            const process = drag(fixture)
            process.approve?.()
            const after = fixture.read()
            expect(after).not.toEqual(before)
            expect(fixture.editing.undo()).toBe(true)
            expect(fixture.read()).toEqual(before)
            expect(fixture.editing.redo()).toBe(true)
            expect(fixture.read()).toEqual(after)
        })
        it("cancellation keeps a concurrent edit of another field", () => {
            const fixture = create(owner)
            const before = fixture.read()
            const process = fixture.begin(gesture, start)
            process.update(fixture.at(moves[0]))
            fixture.editing.modify(() => fixture.box.gain.setValue(-6))
            process.update(fixture.at(moves[1]))
            process.cancel?.()
            expect(fixture.read()).toEqual({...before, gain: -6})
        })
        it("cancellation and later moves keep a concurrent edit of the same field", () => {
            const fixture = create(owner)
            const process = fixture.begin(gesture, start)
            process.update(fixture.at(moves[0]))
            const field = gesture === "resize" ? fixture.durationField : fixture.box.waveformOffset
            fixture.editing.modify(() => field.setValue(1234))
            process.update(fixture.at(moves[1]))
            expect(field.getValue()).toBe(1234)
            process.cancel?.()
            expect(field.getValue()).toBe(1234)
        })
        it("cancellation restores after a save marked part of the gesture; settling twice is inert", () => {
            const fixture = create(owner)
            const before = fixture.read()
            const process = fixture.begin(gesture, start)
            process.update(fixture.at(moves[0]))
            fixture.editing.markSaved()
            process.update(fixture.at(moves[1]))
            process.cancel?.()
            process.approve?.()
            process.cancel?.()
            expect(fixture.read()).toEqual(before)
        })
        it("a target deleted during the gesture settles without writes", () => {
            const fixture = create(owner)
            const process = fixture.begin(gesture, start)
            process.update(fixture.at(moves[0]))
            fixture.editing.modify(() => fixture.box.delete())
            expect(() => process.update(fixture.at(moves[1]))).not.toThrow()
            expect(() => process.cancel?.()).not.toThrow()
            expect(fixture.box.isAttached()).toBe(false)
        })
    })
    describe("loop resize keeps a positive duration", () => {
        it.each([true, false])("dragging to and beyond the start (snapping %s)", snapping => {
            const fixture = create(owner, {snapping})
            for (const target of [0, -PPQN.Quarter, -PPQN.Bar * 2]) {
                const process = fixture.begin("resize", PPQN.Bar)
                process.update(fixture.at(target))
                expect(fixture.reader.loopDuration).toBe(PPQN.SemiQuaver)
                expect(fixture.durationField.getValue()).toBe(PPQN.SemiQuaver)
                process.approve?.()
                expect(fixture.editing.undo()).toBe(true)
                expect(fixture.durationField.getValue()).toBe(PPQN.Bar)
            }
        })
        it("keeps an initially shorter clip as its own floor; regions keep the reader floor", () => {
            const fixture = create(owner, {duration: 100, snapping: false})
            const process = fixture.begin("resize", 100)
            process.update(fixture.at(-PPQN.Bar))
            expect(fixture.reader.loopDuration).toBe(owner === "clip" ? 100 : PPQN.SemiQuaver)
            process.update(fixture.at(300))
            expect(fixture.reader.loopDuration).toBe(300)
            process.update(fixture.at(150))
            expect(fixture.reader.loopDuration).toBe(owner === "clip" ? 150 : PPQN.SemiQuaver)
            process.update(fixture.at(50))
            expect(fixture.reader.loopDuration).toBe(owner === "clip" ? 100 : PPQN.SemiQuaver)
            process.approve?.()
            const next = fixture.begin("resize", fixture.reader.loopDuration)
            next.update(fixture.at(400))
            next.update(fixture.at(-PPQN.Bar))
            expect(fixture.reader.loopDuration).toBe(owner === "clip" ? 100 : PPQN.SemiQuaver)
            next.cancel?.()
        })
    })
})

it("audio clip loop resize converts PPQN into a seconds time base", () => {
    const fixture = create("clip", {duration: 2, timeBase: TimeBase.Seconds})
    expect(fixture.reader.loopDuration).toBe(PPQN.Bar)
    const process = fixture.begin("resize", PPQN.Bar)
    process.update(fixture.at(PPQN.Bar + PPQN.Quarter * 2))
    process.approve?.()
    expect(fixture.durationField.getValue()).toBeCloseTo(3, 5)
    expect(fixture.reader.loopDuration).toBeCloseTo(PPQN.Bar + PPQN.Quarter * 2, 3)
})
