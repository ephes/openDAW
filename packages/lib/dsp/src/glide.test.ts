import {afterEach, describe, expect, it, vi} from "vitest"
import {Glide} from "./glide"

afterEach(() => vi.unstubAllGlobals())
const create = () => {vi.stubGlobal("sampleRate", 960); const glide = new Glide(); glide.init(100); return glide}
describe("Glide terminal pitch", () => {
    it("commits a terminal pitch inside a block before retargeting", () => {
        const glide = create()
        glide.glideTo(200, 2)
        const output = new Float32Array([77, 1, 1, 1, 88])
        glide.process(output, 60, 1, 4)
        expect(Array.from(output)).toEqual([77, 150, 200, 200, 88])
        expect(glide.currentFrequency()).toBe(200)
        glide.glideTo(400, 2)
        output.fill(1)
        glide.process(output, 60, 0, 1)
        expect(output[0]).toBe(300)
    })
    it("immediate retargeting interrupts a moving glide", () => {
        const glide = create()
        glide.glideTo(200, 4)
        glide.advance(60, 0, 1)
        glide.glideTo(300, 0)
        expect(glide.currentFrequency()).toBe(300)
        const output = new Float32Array([1, 2, 1])
        glide.process(output, 60, 0, 3)
        expect(Array.from(output)).toEqual([300, 600, 300])
        glide.advance(60, 0, 10)
        expect(glide.currentFrequency()).toBe(300)
    })
    it("process and advance agree across completion and reset/init", () => {
        const processed = create()
        const advanced = create()
        processed.glideTo(250, 3)
        advanced.glideTo(250, 3)
        for (const length of [1, 1, 3]) {
            processed.process(new Float32Array(length).fill(1), 60, 0, length)
            advanced.advance(60, 0, length)
            expect(processed.currentFrequency()).toBeCloseTo(advanced.currentFrequency(), 10)
        }
        processed.reset()
        processed.init(100)
        const fresh = create()
        const actual = new Float32Array(5).fill(1)
        const expected = actual.slice()
        processed.process(actual, 60, 0, 5)
        fresh.process(expected, 60, 0, 5)
        expect(actual).toEqual(expected)
    })
})
