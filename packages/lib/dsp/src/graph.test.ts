import {describe, expect, it} from "vitest"
import {int} from "@opendaw/lib-std"
import {Graph, TopologicalSort} from "./graph"

describe("graph", () => {
    it("topology", () => {
        const graph = new Graph<int>()
        const sort = new TopologicalSort<int>(graph)
        graph.addVertex(0)
        graph.addVertex(1)
        graph.addVertex(2)
        sort.update()
        expect(sort.sorted()).toStrictEqual([0, 1, 2])
        graph.addEdge([0, 1])
        graph.addEdge([1, 2])
        sort.update()
        expect(sort.sorted()).toStrictEqual([0, 1, 2])
        graph.removeEdge([0, 1])
        graph.removeEdge([1, 2])
        sort.update()
        expect(sort.sorted()).toStrictEqual([0, 1, 2])
        graph.addEdge([2, 1])
        graph.addEdge([1, 0])
        sort.update()
        expect(sort.sorted()).toStrictEqual([2, 1, 0])
    })
})
// Removing either endpoint must retire duplicate incident edges, even if their leases release later.
it("retires incident edges before edge leases", () => {
    const graph = new Graph<string>()
    graph.addVertex("a"); graph.addVertex("b"); graph.addVertex("c")
    graph.addEdge(["a", "b"]); graph.addEdge(["a", "b"]); graph.addEdge(["b", "c"])
    graph.removeVertex("a")
    expect(graph.getPredecessors("b")).toEqual([])
    expect(() => graph.removeEdge(["a", "b"])).not.toThrow()
    graph.removeVertex("c")
    expect(() => graph.removeEdge(["b", "c"])).not.toThrow()
    const sort = new TopologicalSort(graph)
    sort.update()
    expect(sort.sorted()).toEqual(["b"])
})

it("releases one duplicate edge at a time", () => {
    const graph = new Graph<number>()
    graph.addVertex(0); graph.addVertex(1)
    graph.addEdge([0, 1]); graph.addEdge([0, 1])
    graph.removeEdge([0, 1])
    expect(graph.getPredecessors(1)).toEqual([0])
})

it("sorts with linear predecessor work", () => {
    const graph = new Graph<number>()
    for (let i = 0; i < 160; i++) {graph.addVertex(i)}
    for (let i = 1; i < 160; i++) {graph.addEdge([i - 1, i])}
    const original = graph.getPredecessors.bind(graph)
    let visits = 0
    graph.getPredecessors = vertex => {
        const values = original(vertex)
        return new Proxy(values, {get(target, property, receiver) {
            if (property === Symbol.iterator) {return function* () {for (const v of target) {visits++; yield v}}}
            return Reflect.get(target, property, receiver)
        }})
    }
    // Count Set traversal as well: the old implementation hides quadratic closure here.
    const iterator = Set.prototype[Symbol.iterator]
    Set.prototype[Symbol.iterator] = function* () {for (const v of iterator.call(this)) {visits++; yield v}}
    try {
        const sort = new TopologicalSort(graph)
        sort.update()
        expect(sort.sorted()).toEqual(Array.from({length: 160}, (_, i) => i))
        expect(visits).toBeLessThan(160 * 12)
    } finally {Set.prototype[Symbol.iterator] = iterator}
})

it("sorts a long reverse chain without recursive stack growth", () => {
    const graph = new Graph<number>()
    for (let i = 0; i < 20000; i++) {graph.addVertex(i)}
    for (let i = 1; i < 20000; i++) {graph.addEdge([i, i - 1])}
    const sort = new TopologicalSort(graph)
    sort.update()
    expect(sort.sorted()[0]).toBe(19999)
    expect(sort.sorted()).toHaveLength(20000)
    expect(sort.hasLoops()).toBe(false)
})

it("keeps deterministic cycle membership and predecessor order", () => {
    const graph = new Graph<string>()
    for (const v of ["out", "a", "b", "in", "self", "free"]) {graph.addVertex(v)}
    for (const edge of [["a", "out"], ["a", "b"], ["b", "a"], ["in", "b"], ["self", "self"]]) {
        graph.addEdge(edge as [string, string])
    }
    const sort = new TopologicalSort(graph)
    sort.update()
    expect(sort.sorted()).toEqual(["a", "out", "in", "b", "self", "free"])
    expect(sort.hasLoops()).toBe(true)
    graph.removeEdge(["b", "a"]); graph.removeEdge(["self", "self"])
    sort.update()
    expect(sort.hasLoops()).toBe(false)
    expect(sort.sorted()).toEqual(["a", "out", "in", "b", "self", "free"])
})
