import {describe, expect, it} from "vitest"
import {BoxEditing, Vertex} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioBusBox, SelectionBox, UserInterfaceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {VertexSelection} from "./VertexSelection"

const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const first = mandatoryBoxes.userInterfaceBoxes[0]
    const second = editing.modify(() => UserInterfaceBox.create(boxGraph, UUID.generate(), box =>
        box.root.refer(mandatoryBoxes.rootBox.users))).unwrap()
    const selection = new VertexSelection(editing, boxGraph).switch(first.selection)
    const third = editing.modify(() => AudioBusBox.create(boxGraph, UUID.generate(), box => {
        box.collection.refer(mandatoryBoxes.rootBox.audioBusses)
        box.output.refer(mandatoryBoxes.primaryAudioBusBox.input)
    })).unwrap()
    const vertices = [mandatoryBoxes.primaryAudioUnitBox, mandatoryBoxes.primaryAudioBusBox, third]
    const filtered = selection.createFilteredSelection<Vertex>(() => true, {fx: value => value, fy: value => value})
    return {boxGraph, selection, filtered, first, second, vertices}
}

describe("selection reentrancy", () => {
    it("defers external graph notifications until pointer finalization has finished", async () => {
        const {boxGraph, selection, filtered, first, vertices: [vertex, next]} = fixture()
        selection.subscribe({onSelected: value => {
            if (value === vertex) {selection.deselect(value); selection.select(next)}
        }, onDeselected: () => {}})
        new BoxEditing(boxGraph).modify(() => SelectionBox.create(boxGraph, UUID.generate(), box => {
            box.selectable.refer(vertex)
            box.selection.refer(first.selection)
        }))
        await Promise.resolve()
        expect(selection.selected()).toEqual([next])
        expect(filtered.selected()).toEqual([next])
        expect(boxGraph.boxes().filter(box => box instanceof SelectionBox)).toHaveLength(1)
        boxGraph.verifyPointers()
    })
    it("supports nested deselect during a selection callback", () => {
        const {boxGraph, selection, filtered, vertices: [vertex]} = fixture()
        selection.subscribe({onSelected: value => selection.deselect(value), onDeselected: () => {}})
        selection.select(vertex)
        expect(selection.selected()).toEqual([])
        expect(filtered.selected()).toEqual([])
        expect(boxGraph.boxes().filter(box => box instanceof SelectionBox)).toHaveLength(0)
        boxGraph.verifyPointers()
    })
    it("supports nested reselect during a deselection callback", () => {
        const {boxGraph, selection, filtered, vertices: [vertex]} = fixture()
        selection.select(vertex)
        selection.subscribe({onSelected: () => {}, onDeselected: value => selection.select(value)})
        selection.deselect(vertex)
        expect(selection.selected()).toEqual([vertex])
        expect(filtered.selected()).toEqual([vertex])
        expect(boxGraph.boxes().filter(box => box instanceof SelectionBox)).toHaveLength(1)
        boxGraph.verifyPointers()
    })
    it("publishes committed indexes before select and deselect callbacks", () => {
        const {boxGraph, selection, filtered, vertices: [vertex]} = fixture()
        const states: unknown[] = []
        let repeated = false
        selection.subscribe({onSelected: value => {
            states.push([selection.count(), selection.isSelected(value), filtered.count()])
            if (!repeated) {repeated = true; selection.select(value)}
        }, onDeselected: value => states.push([selection.count(), selection.isSelected(value), filtered.count()])})
        selection.select(vertex)
        expect(boxGraph.boxes().filter(box => box instanceof SelectionBox)).toHaveLength(1)
        selection.deselect(vertex)
        expect(states).toEqual([[1, true, 1], [0, false, 0]])
        expect(boxGraph.boxes().filter(box => box instanceof SelectionBox)).toHaveLength(0)
        boxGraph.verifyPointers()
    })
    it.each([false, true])("owns catchup and live delivery for filtered=%s", useFiltered => {
        const {selection, filtered, vertices: [left, right, third]} = fixture()
        selection.select(left, right)
        const [first, second] = selection.selected()
        const source = useFiltered ? filtered : selection
        const events: string[] = []
        const subscription = source.catchupAndSubscribe({onSelected: value => {
            events.push(`+${value.address}`)
            if (value === first) {selection.deselect(second); selection.select(third)}
        }, onDeselected: value => events.push(`-${value.address}`)})
        expect(events).toEqual([`+${first.address}`, `+${third.address}`])
        subscription.terminate()
        selection.deselectAll()
        expect(events).toHaveLength(2)
    })
    it.each([false, true])("unsubscribes after a throwing catchup for filtered=%s", useFiltered => {
        const {selection, filtered, vertices: [first, second]} = fixture()
        selection.select(first)
        let calls = 0
        expect(() => (useFiltered ? filtered : selection).catchupAndSubscribe({
            onSelected: () => {calls++; throw new Error("synthetic replay failure")}, onDeselected: () => calls++
        })).toThrow("synthetic replay failure")
        selection.select(second)
        selection.deselectAll()
        expect(calls).toBe(1)
    })
    it("keeps a target installed during old selection release", () => {
        const {boxGraph, selection, filtered, second, vertices: [first, next]} = fixture()
        selection.select(first)
        selection.subscribe({onSelected: () => {}, onDeselected: value => {
            if (value === first) {selection.switch(second.selection); selection.select(next)}
        }})
        selection.release()
        expect(selection.selected()).toEqual([next])
        expect(filtered.selected()).toEqual([next])
        expect(second.selection.pointerHub.incoming()).toHaveLength(1)
        boxGraph.verifyPointers()
        selection.deselect(next)
        expect(second.selection.pointerHub.incoming()).toHaveLength(0)
    })
    it("does not deselect a new generation's reused member while draining release", () => {
        const {boxGraph, selection, filtered, second, vertices: [left, right]} = fixture()
        selection.select(left, right)
        const [first] = selection.selected()
        selection.subscribe({onSelected: () => {}, onDeselected: value => {
            if (value === first) {selection.switch(second.selection); selection.select(left, right)}
        }})
        selection.release()
        expect(selection.count()).toBe(2)
        expect(filtered.selected()).toEqual(selection.selected())
        expect(second.selection.pointerHub.incoming()).toHaveLength(2)
        boxGraph.verifyPointers()
    })
})
