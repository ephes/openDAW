import {afterEach, describe, expect, it, vi} from "vitest"
import {ByteArrayOutput, Option} from "@opendaw/lib-std"
import {BoxGraph} from "@opendaw/lib-box"
import {BoxIO} from "@opendaw/studio-boxes"
import {ClipboardUtils} from "./ClipboardUtils"

const envelope = (metadataLength: number, graphLength?: number, graph?: ArrayBufferLike) => {
    const output = ByteArrayOutput.create()
    output.writeInt(metadataLength)
    if (graphLength !== undefined) {output.writeInt(graphLength)}
    if (graph) {output.writeBytes(new Int8Array(graph))}
    return output.toArrayBuffer()
}
afterEach(() => vi.unstubAllGlobals())

describe("clipboard binary length admission", () => {
    it.each([-1, 1024 * 1024 * 1024])("refuses metadata length %i before allocating", length => {
        const data = envelope(length)
        const construct = vi.fn((target, args) => {
            if (typeof args[0] === "number" && args[0] > 1024) {throw new Error("unexpected allocation")}
            return Reflect.construct(target, args)
        })
        vi.stubGlobal("Int8Array", new Proxy(Int8Array, {construct}))
        expect(() => ClipboardUtils.extractMetadata(data)).toThrow()
        expect(construct).not.toHaveBeenCalled()
    })
    it.each([-1, 1024 * 1024 * 1024])("refuses graph length %i before allocating", length => {
        const data = envelope(0, length)
        const construct = vi.fn((target, args) => {
            if (typeof args[0] === "number" && args[0] > 1024) {throw new Error("unexpected allocation")}
            return Reflect.construct(target, args)
        })
        vi.stubGlobal("Int8Array", new Proxy(Int8Array, {construct}))
        const target = new BoxGraph(Option.wrap(BoxIO.create))
        expect(() => ClipboardUtils.deserializeBoxes(data, target, {mapPointer: () => Option.None})).toThrow()
        expect(construct).not.toHaveBeenCalled()
        expect(target.boxes()).toHaveLength(0)
    })
    it("preflights nested box lengths before graph allocation", () => {
        const graph = ByteArrayOutput.create()
        graph.writeInt(1)
        graph.writeInt(1024 * 1024 * 1024)
        const bytes = graph.toArrayBuffer()
        const data = envelope(0, bytes.byteLength, bytes)
        const allocations: number[] = []
        vi.stubGlobal("Int8Array", new Proxy(Int8Array, {construct: (target, args) => {
            if (typeof args[0] === "number") {allocations.push(args[0])}
            if (args[0] > 1024) {throw new Error("unexpected large allocation")}
            return Reflect.construct(target, args)
        }}))
        const target = new BoxGraph(Option.wrap(BoxIO.create))
        expect(() => ClipboardUtils.deserializeBoxes(data, target, {mapPointer: () => Option.None})).toThrow()
        expect(allocations.every(size => size <= bytes.byteLength)).toBe(true)
        expect(target.boxes()).toHaveLength(0)
    })
    it("rejects truncated graph bytes and trailing envelope bytes", () => {
        const dataSet = [envelope(0, 4), envelope(0, 0, new ArrayBuffer(1))]
        const construct = vi.fn((target, args) => Reflect.construct(target, args))
        vi.stubGlobal("Int8Array", new Proxy(Int8Array, {construct}))
        for (const data of dataSet) {
            const target = new BoxGraph(Option.wrap(BoxIO.create))
            expect(() => ClipboardUtils.deserializeBoxes(data, target, {mapPointer: () => Option.None})).toThrow()
            expect(target.boxes()).toHaveLength(0)
        }
        expect(construct).not.toHaveBeenCalled()
    })
})
