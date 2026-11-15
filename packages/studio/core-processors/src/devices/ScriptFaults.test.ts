import {expect, it} from "vitest"
import {block, outputNote, ScriptBlock} from "./script-test-fixture"
import {spielFixture} from "./midi-effects/spielwerk-test-fixture"
import {werkFixture} from "./audio-effects/werkstatt-test-fixture"

type IO = {out: Float32Array[]}
class Good {
    *process(b: ScriptBlock) {yield outputNote(b.from)}
}
class GoodAudio {
    process(io: IO) {io.out.forEach(ch => ch.fill(0.5))}
}
it.each(["spiel", "werk"])("%s quarantines parameter callback faults once and recovers on compile", async kind => {
    let calls = 0
    class Bad {
        paramChanged(_label: string, value: number) {calls++; if (value > 0) throw new Error("automation")}
        *process() {}
    }
    const f = kind === "spiel" ? spielFixture(Bad) : await werkFixture(Bad)
    const before = calls
    expect(() => f.edit(() => f.param.value.setValue(0.5))).not.toThrow()
    f.edit(() => f.param.value.setValue(0.75))
    expect(calls).toBe(before + 1)
    expect(f.messages).toHaveLength(1)
    f.compile(kind === "spiel" ? Good : GoodAudio)
    if (kind === "spiel") {
        const p = f as ReturnType<typeof spielFixture>
        expect([...p.processor.processNotes(0, 10, 0)].length).toBeGreaterThan(0)
    } else {
        const p = f as Awaited<ReturnType<typeof werkFixture>>
        p.processor.process({blocks: [block()]})
        expect(p.processor.audioOutput.getChannel(0)[0]).toBe(0.5)
    }
    const sibling = await werkFixture(GoodAudio)
    sibling.processor.process({blocks: [block()]})
    expect(sibling.processor.audioOutput.getChannel(0)[0]).toBe(0.5)
})
it.each(["spiel", "werk"])("%s attempts a failed constructor once, polls missing entries and loads newer code", async kind => {
    let attempts = 0
    class Bad {constructor() {attempts++; throw new Error("constructor")}}
    const f = kind === "spiel" ? spielFixture(Bad, false) : await werkFixture(Bad, false)
    const render = () => {
        if (kind === "spiel") [...(f as ReturnType<typeof spielFixture>).processor.processNotes(0, 10, 0)]
        else f.processor.process({blocks: [block()]})
    }
    render(); render()
    expect(f.messages).toEqual([])
    f.registry[f.key] = {update: 1, create: Bad}
    for (let i = 0; i < 1000; i++) render()
    expect(attempts).toBe(1)
    expect(f.messages).toHaveLength(1)
    f.compile(kind === "spiel" ? Good : GoodAudio)
    render()
    expect(f.messages).toHaveLength(1)
})
