import {expect, it} from "vitest"
import {NoteLifecycleEvent as E} from "./NoteEventSource"
it("obeys comparator laws and places all simultaneous completions before starts", () => {
    const a = E.start(1, 1, 60, 1), b = E.start(1, 1, 64, 1)
    const events = [E.start(0, 1, 60, 1), a, b, E.stop(a, 1), E.stop(b, 1), E.stop(b, 2)]
    const cmp = E.Comparator
    events.forEach(x => {
        expect(cmp(x, x)).toBe(0)
        events.forEach(y => {
            expect(Math.sign(cmp(x, y)) + Math.sign(cmp(y, x))).toBe(0)
            events.forEach(z => {if (cmp(x, y) <= 0 && cmp(y, z) <= 0) expect(cmp(x, z)).toBeLessThanOrEqual(0)})
        })
    })
    const shuffled = [a, E.stop(b, 1), b, E.stop(a, 1)]
    expect(shuffled.sort(cmp).map(e => [e.type, e.id])).toEqual([
        ["note-complete-event", b.id], ["note-complete-event", a.id], ["note-event", a.id], ["note-event", b.id]])
})
