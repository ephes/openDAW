// eslint-disable-next-line no-restricted-imports -- Integration-only access to the private monitoring router.
import {MonitoringRouter} from "../../packages/studio/core/src/MonitoringRouter"
import {UUID} from "@opendaw/lib-std"
import type {EngineCommands} from "@opendaw/studio-adapters"
import {installAutoScroll} from "@/ui/AutoScroll"
import {Surface} from "@/ui/surface/Surface"

export const monitoringGraph = async () => {
    const context = new AudioContext()
    const url = URL.createObjectURL(new Blob([`registerProcessor('synthetic-monitor', class extends AudioWorkletProcessor {
        process() { return true }
    })`], {type: "text/javascript"}))
    type Edge = {source: AudioNode, destination: AudioNode, output: number, input: number}
    let edges: Edge[] = []
    const track = <T extends AudioNode>(node: T): T => {
        const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node)
        node.connect = ((destination: AudioNode, output = 0, input = 0) => {
            const result = connect(destination, output, input)
            edges.push({source: node, destination, output, input})
            return result
        }) as AudioNode["connect"]
        node.disconnect = ((destination?: AudioNode, output = 0, input = 0) => {
            if (destination === undefined) {disconnect()} else {disconnect(destination, output, input)}
            edges = edges.filter(edge => edge.source !== node || (destination !== undefined
                && (edge.destination !== destination || edge.output !== output || edge.input !== input)))
        }) as AudioNode["disconnect"]
        return node
    }
    try {
        await context.audioWorklet.addModule(url)
        const splitter = context.createChannelSplitter.bind(context), merger = context.createChannelMerger.bind(context)
        context.createChannelSplitter = count => track(splitter(count))
        context.createChannelMerger = count => track(merger(count))
        const worklet = track(new AudioWorkletNode(context, "synthetic-monitor", {numberOfOutputs: 2, outputChannelCount: [2, 8]}))
        const source = track(context.createGain()), foreign = context.createGain(), destination = context.createGain()
        source.connect(foreign); worklet.connect(foreign, 0)
        let published: unknown = [], fail = false
        const router = new MonitoringRouter(worklet, {updateMonitoringMap: (map: unknown) => {
            published = map
            if (fail) {fail = false; throw new Error("synthetic publication failure")}
        }} as unknown as EngineCommands)
        const uuid = UUID.generate(), counts: number[] = []
        for (let i = 0; i < 10; i++) {router.registerSource(uuid, source, 2, destination); counts.push(edges.length)}
        fail = true
        try {router.registerSource(uuid, source, 2, destination)} catch { /* Verify rollback below. */ }
        counts.push(edges.length)
        router.unregisterSource(uuid); counts.push(edges.length)
        router.registerSource(uuid, source, 2, destination)
        router.terminate(); router.terminate(); counts.push(edges.length)
        const foreignSurvived = edges.every(edge => edge.destination === foreign)
        source.disconnect(foreign); worklet.disconnect(foreign, 0, 0)
        return {counts, foreignSurvived, published}
    } finally {URL.revokeObjectURL(url); await context.close()}
}

export const pointerOwnership = async () => {
    const previous = Surface.get
    Surface.get = () => ({owner: window}) as unknown as Surface
    const target = document.createElement("div")
    document.body.append(target)
    let measured = 0, scrolled = 0
    const owner = installAutoScroll(target, () => {scrolled++}, {measure: () => {
        measured++; return {xMin: 0, xMax: 100, yMin: 0, yMax: 100}
    }})
    const pointer = (to: EventTarget, type: string, pointerId: number) => to.dispatchEvent(new PointerEvent(type, {pointerId, clientX: 200}))
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
        pointer(target, "pointerdown", 1); pointer(document, "pointermove", 1)
        pointer(document, "pointermove", 2); pointer(document, "pointerup", 2)
        await frame()
        const continued = scrolled > 0 && measured === 1
        pointer(document, "pointercancel", 1)
        const stoppedAt = scrolled
        await frame()
        pointer(target, "pointerdown", 1); pointer(document, "pointermove", 1)
        owner.terminate(); owner.terminate()
        const measuredAt = measured
        pointer(document, "pointermove", 1); pointer(target, "pointerdown", 1)
        await frame()
        return {continued, stopped: scrolled === stoppedAt, retired: measured === measuredAt}
    } finally {owner.terminate(); target.remove(); Surface.get = previous}
}
