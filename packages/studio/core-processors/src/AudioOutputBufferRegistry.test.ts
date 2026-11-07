import {expect, it} from "vitest"
import {Address} from "@opendaw/lib-box"
import {AudioBuffer} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {AudioOutputBufferRegistry} from "./AudioOutputBufferRegistry"
import {Processor} from "./processing"
import {EventBuffer} from "./EventBuffer"
it("resolves equal addresses, retains the first duplicate, and only removes its owned registration", () => {
    const r = new AudioOutputBufferRegistry(), id = UUID.generate(), a = Address.compose(id, 1), b = Address.compose(id, 2)
    const processor: Processor = {eventInput: new EventBuffer(), process() {}, reset() {}}
    const first = new AudioBuffer(), second = new AudioBuffer()
    const owner = r.register(a, first, processor), neighbor = r.register(b, second, processor)
    expect(r.resolve(Address.compose(id.slice(), 1)).unwrap().buffer).toBe(first)
    const duplicate = r.register(a, second, processor)
    expect(r.resolve(a).unwrap().buffer).toBe(first)
    duplicate.terminate(); expect(r.resolve(a).unwrap().buffer).toBe(first)
    owner.terminate(); expect(r.resolve(a).isEmpty()).toBe(true)
    const replacement = r.register(a, second, processor)
    owner.terminate(); expect(r.resolve(a).unwrap().buffer).toBe(second)
    expect(r.resolve(b).unwrap().processor).toBe(processor)
    neighbor.terminate(); expect(r.resolve(b).isEmpty()).toBe(true)
    replacement.terminate(); expect(r.resolve(a).isEmpty()).toBe(true)
})
