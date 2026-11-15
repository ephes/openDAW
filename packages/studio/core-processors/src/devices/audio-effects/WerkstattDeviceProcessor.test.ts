import {expect, it} from "vitest"
import {block} from "../script-test-fixture"
import {werkFixture} from "./werkstatt-test-fixture"

type IO = {out: Float32Array[]}
it.each(["empty", "short", "foreign", "array", "detach"])("quarantines %s output replacement without publishing stale samples", async kind => {
    let pass = 0
    const f = await werkFixture(class {
        process(io: IO) {
            if (++pass === 1) {io.out.forEach(ch => ch.fill(0.75)); return}
            if (kind === "detach") structuredClone(io.out[0].buffer, {transfer: [io.out[0].buffer as ArrayBuffer]})
            else if (kind === "array") io.out = [new Float32Array(128), new Float32Array(128)]
            else io.out[0] = new Float32Array(kind === "empty" ? 0 : kind === "short" ? 4 : 128)
        }
    })
    f.processor.process({blocks: [block()]})
    expect(f.processor.audioOutput.getChannel(0)[0]).toBe(0.75)
    expect(() => f.processor.process({blocks: [block()]})).not.toThrow()
    expect(f.messages).toHaveLength(1)
    expect([...f.processor.audioOutput.getChannel(0)]).toEqual(Array(128).fill(0))
    f.compile(class {process(io: IO) {io.out.forEach(ch => ch.fill(0.25))}})
    f.processor.process({blocks: [block()]})
    expect(f.processor.audioOutput.getChannel(0)[0]).toBe(0.25)
})
it("publishes normal in-place writes only for the requested span", async () => {
    const f = await werkFixture(class {process(io: IO, b: {s0: number, s1: number}) {
        io.out.forEach(ch => ch.fill(0.4, b.s0, b.s1))
    }})
    f.processor.process({blocks: [{...block(), s0: 7, s1: 31}]})
    expect(f.processor.audioOutput.getChannel(0)[6]).toBe(0)
    expect(f.processor.audioOutput.getChannel(0)[7]).toBeCloseTo(0.4)
    expect(f.processor.audioOutput.getChannel(0)[31]).toBe(0)
})
