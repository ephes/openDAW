import {describe, expect, it, vi} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {EngineCommands} from "@opendaw/studio-adapters"
import {MonitoringRouter} from "./MonitoringRouter"

class Node {
    edges: Array<[Node, number, number]> = []
    constructor(readonly context: Context) {}
    connect(to: Node, output = 0, input = 0): void {
        this.context.step()
        this.edges.push([to, output, input])
    }
    disconnect(to?: Node, output = 0, input = 0): void {
        this.edges = to === undefined ? [] : this.edges.filter(edge =>
            edge[0] !== to || edge[1] !== output || edge[2] !== input)
    }
}
class Context {
    nodes: Array<Node> = []
    failAt = Infinity
    steps = 0
    step(): void {if (++this.steps === this.failAt) {throw new Error("injected")}}
    node(): Node {const node = new Node(this); this.nodes.push(node); return node}
    createChannelSplitter(): Node {this.step(); return this.node()}
    createChannelMerger(): Node {this.step(); return this.node()}
    count(): number {return this.nodes.reduce((sum, node) => sum + node.edges.length, 0)}
}
const setup = () => {
    const context = new Context()
    const worklet = context.node()
    const updateMonitoringMap = vi.fn()
    const router = new MonitoringRouter(worklet as unknown as AudioWorkletNode, {updateMonitoringMap} as unknown as EngineCommands)
    const source = context.node(), destination = context.node(), foreign = context.node()
    source.connect(foreign)
    const uuid = UUID.generate()
    const register = () => router.registerSource(uuid, source as unknown as AudioNode, 2, destination as unknown as AudioNode)
    return {context, worklet, updateMonitoringMap, router, source, foreign, uuid, register}
}

describe("monitoring graph ownership", () => {
    it("retires every owned edge, retaining unrelated connections", () => {
        const {context, router, register, uuid, source, foreign, updateMonitoringMap} = setup()
        for (let i = 0; i < 10; i++) {register(); expect(context.count()).toBe(9)}
        router.unregisterSource(uuid)
        expect(context.count()).toBe(2)
        register()
        router.terminate(); router.terminate()
        expect(context.count()).toBe(1)
        expect(source.edges[0][0]).toBe(foreign)
        expect(updateMonitoringMap).toHaveBeenLastCalledWith([])
    })
    it("rolls back each preparation/connect failure and permits retry", () => {
        for (let step = 1; step <= 10; step++) {
            const {context, router, register, updateMonitoringMap} = setup()
            register()
            const previousMap = updateMonitoringMap.mock.lastCall?.[0]
            const count = context.count()
            context.failAt = context.steps + step
            expect(register).toThrow("injected")
            expect(context.count()).toBe(count)
            expect(updateMonitoringMap.mock.lastCall?.[0]).toEqual(previousMap)
            context.failAt = Infinity
            register()
            expect(context.count()).toBe(count)
            router.terminate()
        }
    })
    it("restores a map whose publication throws after changing it", () => {
        const {context, router, register, updateMonitoringMap} = setup()
        register()
        const count = context.count()
        const previous = updateMonitoringMap.mock.lastCall?.[0]
        updateMonitoringMap.mockImplementationOnce(() => {throw new Error("publish")})
        expect(register).toThrow("publish")
        expect(updateMonitoringMap).toHaveBeenLastCalledWith(previous)
        expect(context.count()).toBe(count)
        register(); router.terminate()
    })
    it("stops explicitly if map restoration fails", () => {
        const {context, router, register, updateMonitoringMap} = setup()
        register()
        updateMonitoringMap.mockImplementationOnce(() => {throw new Error("publish")})
            .mockImplementationOnce(() => {throw new Error("restore")})
        expect(register).toThrow(/stopped/)
        expect(context.count()).toBe(1)
        expect(updateMonitoringMap).toHaveBeenLastCalledWith([])
        expect(register).toThrow(/terminated/)
        router.terminate()
    })
})
