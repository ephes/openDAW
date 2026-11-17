import {int, Terminable, UUID} from "@opendaw/lib-std"
import {MonitoringMapEntry, EngineCommands} from "@opendaw/studio-adapters"

const MAX_MONITORING_CHANNELS = 8

type MonitoringSource = {
    uuid: UUID.Bytes
    sourceNode: AudioNode
    numChannels: 1 | 2
    destinationNode: AudioNode
}
type Edge = {source: AudioNode, destination: AudioNode, output: number, input: number}
type Route = {edges: Array<Edge>, map: Array<MonitoringMapEntry>}

export class MonitoringRouter implements Terminable {
    readonly #context: BaseAudioContext
    readonly #worklet: AudioWorkletNode
    readonly #commands: EngineCommands
    readonly #splitter: ChannelSplitterNode
    #sources: Array<MonitoringSource> = []
    #route: Route = {edges: [], map: []}
    #terminated = false

    constructor(worklet: AudioWorkletNode, commands: EngineCommands) {
        this.#context = worklet.context
        this.#worklet = worklet
        this.#commands = commands
        this.#splitter = this.#context.createChannelSplitter(MAX_MONITORING_CHANNELS)
        worklet.connect(this.#splitter, 1)
    }

    registerSource(uuid: UUID.Bytes, sourceNode: AudioNode, numChannels: 1 | 2, destinationNode: AudioNode): void {
        const sources = this.#sources.filter(source => !UUID.equals(source.uuid, uuid))
        sources.push({uuid, sourceNode, numChannels, destinationNode})
        sources.sort((a, b) => UUID.Comparator(a.uuid, b.uuid))
        this.#rebuild(sources)
    }

    unregisterSource(uuid: UUID.Bytes): void {
        this.#rebuild(this.#sources.filter(source => !UUID.equals(source.uuid, uuid)))
    }

    #retire(route: Route): void {
        for (const {source, destination, output, input} of route.edges.reverse()) {
            source.disconnect(destination, output, input)
        }
        route.edges.length = 0
    }

    #rebuild(sources: Array<MonitoringSource>): void {
        if (this.#terminated) {throw new Error("MonitoringRouter is terminated")}
        const proposed: Route = {edges: [], map: []}
        const connect = (source: AudioNode, destination: AudioNode, output = 0, input = 0) => {
            source.connect(destination, output, input)
            proposed.edges.push({source, destination, output, input})
        }
        let publishing = false
        try {
            const totalChannels = sources.reduce((sum, source) => sum + source.numChannels, 0)
            if (totalChannels > MAX_MONITORING_CHANNELS) {
                console.warn(`MonitoringRouter: ${totalChannels} channels requested, max is ${MAX_MONITORING_CHANNELS}. Some sources will not receive effects monitoring.`)
            }
            if (totalChannels > 0) {
                const inputMerger = this.#context.createChannelMerger(Math.min(totalChannels, MAX_MONITORING_CHANNELS))
                connect(inputMerger, this.#worklet)
                let channel = 0
                for (const {uuid, sourceNode, numChannels, destinationNode} of sources) {
                    if (channel + numChannels > MAX_MONITORING_CHANNELS) {break}
                    const inputSplitter = this.#context.createChannelSplitter(numChannels)
                    connect(sourceNode, inputSplitter)
                    const channels: Array<int> = []
                    for (let i = 0; i < numChannels; i++) {
                        connect(inputSplitter, inputMerger, i, channel)
                        channels.push(channel++)
                    }
                    proposed.map.push({uuid, channels})
                    const outputMerger = this.#context.createChannelMerger(2)
                    connect(this.#splitter, outputMerger, channels[0], 0)
                    connect(this.#splitter, outputMerger, channels[numChannels === 2 ? 1 : 0], 1)
                    connect(outputMerger, destinationNode)
                }
            }
            publishing = true
            this.#commands.updateMonitoringMap(proposed.map)
        } catch (error) {
            this.#retire(proposed)
            if (publishing) {
                try {this.#commands.updateMonitoringMap(this.#route.map)} catch (restoreError) {
                    try {this.terminate()} catch { /* The graph is stopped even if empty-map publication fails. */ }
                    throw new AggregateError([error, restoreError], "MonitoringRouter stopped: map restoration failed")
                }
            }
            throw error
        }
        this.#retire(this.#route)
        this.#route = proposed
        this.#sources = sources
    }

    terminate(): void {
        if (this.#terminated) {return}
        this.#terminated = true
        this.#retire(this.#route)
        this.#worklet.disconnect(this.#splitter, 1, 0)
        this.#sources = []
        this.#route = {edges: [], map: []}
        this.#commands.updateMonitoringMap([])
    }
}
