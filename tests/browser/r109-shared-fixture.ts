import {RingBuffer, ScriptCompiler, ProjectSkeleton} from "@opendaw/studio-adapters"

import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {SpielwerkDeviceBox, WerkstattDeviceBox} from "@opendaw/studio-boxes"

export const recordingRing = async () => {
    const worker = new Worker(new URL("./r109-ring-worker.ts", import.meta.url), {type: "module"})
    const makeConfig = (): RingBuffer.Config => ({sab: new SharedArrayBuffer(RingBuffer.HEADER_BYTES + 8), numChunks: 2, numberOfChannels: 1, bufferSize: 1})
    const write = (config: RingBuffer.Config, values: number[]) => new Promise<void>(resolve => {
        worker.onmessage = () => resolve()
        worker.postMessage({config, values})
    })
    try {
        const full = makeConfig()
        await write(full, [1, 2])
        let lost = 0, delivered = 0
        RingBuffer.reader(full, () => {delivered++}, frames => {lost = frames}).stop()
        const healthy = makeConfig(), seen: number[] = []
        const reader = RingBuffer.reader(healthy, channels => seen.push(channels[0][0]))
        try {
            for (let i = 1; i <= 8; i++) {
                await write(healthy, [i])
                while (seen.length < i) {await new Promise(resolve => setTimeout(resolve, 1))}
            }
        } finally {reader.stop()}
        return {lost, delivered, seen}
    } finally {worker.terminate()}
}

export const scriptInstallation = async (kind: "werkstatt" | "spielwerk") => {
    const context = new AudioContext()
    const {boxGraph: graph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    const box = editing.modify(() => kind === "werkstatt"
        ? WerkstattDeviceBox.create(graph, UUID.generate(), box => box.host.refer(mandatoryBoxes.primaryAudioUnitBox.audioEffects))
        : SpielwerkDeviceBox.create(graph, UUID.generate(), box => box.host.refer(mandatoryBoxes.primaryAudioUnitBox.midiEffects))).unwrap()
    const compiler = ScriptCompiler.create({headerTag: kind, registryName: kind + "Processors", functionName: kind})
    const realAdd = context.audioWorklet.addModule.bind(context.audioWorklet)
    let delayed = false, finish!: () => Promise<void>
    const facade = {audioWorklet: {addModule: (url: string) => {
        if (!delayed) {return realAdd(url)}
        delayed = false
        return new Promise<void>((resolve, reject) => {
            finish = async () => {try {await realAdd(url); resolve()} catch (error) {reject(error)}}
        })
    }}} as unknown as BaseAudioContext
    const source = (version: number) => `class Processor { constructor() {this.version = ${version}} }`
    const probe = async () => {
        const node = new AudioWorkletNode(context, "r109-script-probe", {processorOptions: {
            registry: kind + "Processors", uuid: UUID.toString(box.address.uuid),
            update: Number(box.code.getValue().split("\n")[0].split(" ")[4])
        }})
        try {
            const result = new Promise<number>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("probe timed out")), 5000)
                node.port.onmessage = ({data}) => {clearTimeout(timer); resolve(data)}
            })
            node.connect(context.destination)
            await context.resume()
            return await result
        } finally {node.disconnect()}
    }
    try {
        await realAdd("/r109-script-probe.ts")
        await compiler.compile(facade, editing, box, source(0))
        const saved = box.code.getValue()
        delayed = true
        const old = compiler.compile(facade, editing, box, source(1))
        await compiler.compile(facade, editing, box, source(2))
        await finish(); await old
        const latest = await probe()
        editing.modify(() => box.code.setValue(saved))
        await compiler.load(facade, box)
        return {latest, undo: await probe()}
    } finally {await context.close()}
}
