import {Arrays, asDefined, assert} from "@opendaw/lib-std"

export type Edge<V> = [V, V]

export class Graph<V> {
    readonly #vertices: Array<V>
    readonly #predecessors: Map<V, Array<V>>

    constructor() {
        this.#vertices = []
        this.#predecessors = new Map<V, Array<V>>()
    }

    addVertex(vertex: V): void {
        assert(!this.#vertices.includes(vertex), "Vertex already exists")
        this.#vertices.push(vertex)
        assert(!this.#predecessors.has(vertex), "Predecessor already exists")
        this.#predecessors.set(vertex, [])
    }

    removeVertex(vertex: V): void {
        Arrays.remove(this.#vertices, vertex)
        const found = this.#predecessors.delete(vertex)
        assert(found, "Predecessor does not exists")
        for (const predecessors of this.#predecessors.values()) {
            for (let index = predecessors.length - 1; index >= 0; index--) {
                if (predecessors[index] === vertex) {predecessors.splice(index, 1)}
            }
        }
    }

    getPredecessors(vertex: V): ReadonlyArray<V> {return this.#predecessors.get(vertex) ?? Arrays.empty()}
    predecessors(): Map<V, V[]> {return this.#predecessors}
    vertices(): ReadonlyArray<V> {return this.#vertices}

    addEdge([source, target]: Edge<V>): void {
        const vertexPredecessors = asDefined(this.#predecessors.get(target),
            `[add] Edge has unannounced vertex. (${target})`)
        vertexPredecessors.push(source)
    }

    removeEdge([source, target]: Edge<V>): void {
        // Vertex retirement already removes its incident edges. Late leases are harmless.
        if (!this.#predecessors.has(source) || !this.#predecessors.has(target)) {return}
        const vertexPredecessors = asDefined(this.#predecessors.get(target))
        assert(vertexPredecessors.includes(source), `${source} is not marked.`)
        Arrays.remove(vertexPredecessors, source)
    }

    isEmpty(): boolean {return this.#vertices.length === 0}
}

export class TopologicalSort<V> {
    readonly #graph: Graph<V>
    readonly #sorted: Array<V> = []
    readonly #withLoops: Set<V> = new Set()

    constructor(graph: Graph<V>) {this.#graph = graph}

    update(): void {
        this.#sorted.length = 0
        this.#withLoops.clear()
        const vertices = this.#graph.vertices()
        const successors = new Map<V, Array<V>>()
        for (const vertex of vertices) {successors.set(vertex, [])}
        for (const vertex of vertices) {
            for (const predecessor of this.#graph.getPredecessors(vertex)) {
                asDefined(successors.get(predecessor)).push(vertex)
            }
        }
        // Kosaraju: finishing order on predecessors, then components on successors.
        const finished: Array<V> = []
        this.#walk(vertices, vertex => this.#graph.getPredecessors(vertex), finished)
        const component = new Map<V, number>()
        for (let index = finished.length - 1; index >= 0; index--) {
            const root = finished[index]
            if (component.has(root)) {continue}
            const id = index
            const members: Array<V> = []
            const pending = [root]
            component.set(root, id)
            while (pending.length > 0) {
                const vertex = pending.pop()!
                members.push(vertex)
                for (const next of asDefined(successors.get(vertex))) {
                    if (component.has(next)) {continue}
                    component.set(next, id)
                    pending.push(next)
                }
            }
            if (members.length > 1 || this.#graph.getPredecessors(root).includes(root)) {
                for (const vertex of members) {this.#withLoops.add(vertex)}
            }
        }
        // As before, omit all intra-cycle edges and visit roots/predecessors in insertion order.
        this.#walk(vertices, vertex => this.#graph.getPredecessors(vertex)
            .filter(previous => component.get(previous) !== component.get(vertex)), this.#sorted)
    }

    sorted(): ReadonlyArray<V> {return this.#sorted}
    hasLoops(): boolean {return this.#withLoops.size !== 0}

    #walk(roots: ReadonlyArray<V>, neighbors: (vertex: V) => ReadonlyArray<V>, finished: Array<V>): void {
        const visited = new Set<V>()
        for (const root of roots) {
            if (visited.has(root)) {continue}
            visited.add(root)
            const stack = [{vertex: root, edges: neighbors(root), index: 0}]
            while (stack.length > 0) {
                const frame = stack[stack.length - 1]
                if (frame.index === frame.edges.length) {
                    finished.push(frame.vertex)
                    stack.pop()
                    continue
                }
                const next = frame.edges[frame.index++]
                if (visited.has(next)) {continue}
                visited.add(next)
                stack.push({vertex: next, edges: neighbors(next), index: 0})
            }
        }
    }
}
