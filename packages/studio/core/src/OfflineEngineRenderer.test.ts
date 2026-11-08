import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Option} from "@opendaw/lib-std"
import {OfflineEngineRenderer} from "./OfflineEngineRenderer"
import {Project} from "./project"

vi.mock("./project", () => ({}))
vi.mock("./AudioWorklets", () => ({AudioWorklets: {install: vi.fn(), processorsUrl: "synthetic-processors"}}))
vi.mock("./midi", () => ({MIDIReceiver: {create: vi.fn()}}))
afterEach(() => vi.restoreAllMocks())

it.each(["create", "render", "abort"])("restores export loop after %s failure", async stage => {
    const enabled = new DefaultObservableValue(true)
    const source = {timelineBox: {loopArea: {enabled}}, boxGraph: {beginTransaction() {}, endTransaction() {}},
        lastRegionAction: () => 960, tempoMap: {intervalToSeconds: () => 1}}
    const fault = stage === "abort" ? new DOMException("cancelled", "AbortError") : new Error(`synthetic ${stage}`)
    const render = vi.fn().mockRejectedValue(fault)
    const terminate = vi.fn()
    const create = vi.spyOn(OfflineEngineRenderer, "create")
    if (stage === "create") {create.mockRejectedValue(fault)}
    else {create.mockResolvedValue({render, terminate} as unknown as OfflineEngineRenderer)}
    await expect(OfflineEngineRenderer.start(source as unknown as Project, Option.None, new DefaultObservableValue(0))).rejects.toBe(fault)
    expect(enabled.getValue()).toBe(true)
    if (stage !== "create") {expect(terminate).toHaveBeenCalledTimes(1)}
})

it.each([true, false])("preserves a newer deliberate loop edit ending at %s", async finalValue => {
    const enabled = new DefaultObservableValue(!finalValue)
    const source = {timelineBox: {loopArea: {enabled}}, boxGraph: {beginTransaction() {}, endTransaction() {}},
        lastRegionAction: () => 960, tempoMap: {intervalToSeconds: () => 1}}
    const gate = Promise.withResolvers<OfflineEngineRenderer>()
    vi.spyOn(OfflineEngineRenderer, "create").mockReturnValue(gate.promise)
    const running = OfflineEngineRenderer.start(source as unknown as Project, Option.None, new DefaultObservableValue(0))
    enabled.setValue(true); enabled.setValue(finalValue)
    gate.reject(new Error("synthetic initialize failure"))
    await expect(running).rejects.toThrow("synthetic initialize failure")
    expect(enabled.getValue()).toBe(finalValue)
})

import {beforeEach} from "vitest"
import {Communicator, Messenger} from "@opendaw/lib-runtime"
import {AnimationFrame} from "@opendaw/lib-dom"
import {ApparatDeviceBox, SpielwerkDeviceBox, WerkstattDeviceBox} from "@opendaw/studio-boxes"
import {UUID} from "@opendaw/lib-std"
import {AudioWorklets} from "./AudioWorklets"
import {MIDIReceiver} from "./midi"

const setup = () => {
    const workers: {terminate: ReturnType<typeof vi.fn>}[] = []
    const ports: {close: ReturnType<typeof vi.fn>, start: ReturnType<typeof vi.fn>}[] = []
    vi.stubGlobal("Worker", class {terminate = vi.fn(); constructor() {workers.push(this)}})
    vi.stubGlobal("MessageChannel", class {
        port1 = {close: vi.fn(), start: vi.fn()}; port2 = {close: vi.fn(), start: vi.fn()}
        constructor() {ports.push(this.port1, this.port2)}
    })
    const messengers: {terminate: ReturnType<typeof vi.fn>}[] = []
    vi.spyOn(Messenger, "for").mockImplementation(() => {
        const messenger = {terminate: vi.fn(), channel: (name: string) => ({name, terminate: vi.fn()})}
        messengers.push(messenger)
        return messenger as unknown as Messenger
    })
    const protocol = {addModule: vi.fn().mockResolvedValue(undefined), initialize: vi.fn().mockResolvedValue(undefined),
        render: vi.fn().mockResolvedValue([new Float32Array(4),new Float32Array(4)]), stop: vi.fn()}
    const commands = {queryLoadingComplete: vi.fn().mockResolvedValue(true), play: vi.fn(), stop: vi.fn(), setupMIDI: vi.fn(), setPosition: vi.fn()}
    vi.spyOn(Communicator, "sender").mockImplementation(messenger =>
        ((messenger as unknown as {name:string}).name === "offline-engine" ? protocol : commands) as never)
    const executors: unknown[] = []
    vi.spyOn(Communicator, "executor").mockImplementation((_messenger, executor) => {
        executors.push(executor); return {terminate: vi.fn()} as never
    })
    const midi = {port: {}, sab: new SharedArrayBuffer(4), terminate: vi.fn()}
    vi.mocked(MIDIReceiver.create).mockReturnValue(midi as unknown as MIDIReceiver)
    const live = {terminate: vi.fn()}
    const source = {boxGraph: {boxes: () => [] as object[]}, liveStreamReceiver: {connect: vi.fn(() => live)},
        receivedMIDIFromEngine: vi.fn(), toArrayBuffer: () => new ArrayBuffer(0), sampleManager: {getOrCreate: vi.fn()}, soundfontManager: {getOrCreate: vi.fn()}}
    OfflineEngineRenderer.install("synthetic-worker")
    AudioWorklets.install("synthetic-processors")
    const polling = {terminate: vi.fn()}
    vi.spyOn(AnimationFrame, "add").mockReturnValue(polling)
    return {source, workers, ports, messengers, protocol, commands, midi, live, polling, executors,
        create: () => OfflineEngineRenderer.create(source as unknown as Project, Option.None)}
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

it.each(["werkstatt", "spielwerk", "apparat", "initialize"])("releases initialization resources after %s failure", async stage => {
    const f = setup()
    const fault = new Error(`synthetic ${stage}`)
    if (stage === "initialize") {f.protocol.initialize.mockRejectedValueOnce(fault)}
    else {
        const type = stage === "werkstatt" ? WerkstattDeviceBox : stage === "spielwerk" ? SpielwerkDeviceBox : ApparatDeviceBox
        const box = Object.create(type.prototype)
        Object.defineProperties(box, {code: {value: {getValue: () => `// @${stage} synth 1 1\nreturn class Processor {}`}}, address: {value: {uuid: UUID.generate()}}})
        f.source.boxGraph.boxes = () => [box]
        f.protocol.addModule.mockRejectedValueOnce(fault)
    }
    await expect(f.create()).rejects.toBe(fault)
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(f.live.terminate).toHaveBeenCalledTimes(1)
    expect(f.midi.terminate).toHaveBeenCalledTimes(1)
    expect(f.ports.every(port => port.close.mock.calls.length === 1)).toBe(true)
    expect(f.messengers.every(m => m.terminate.mock.calls.length === 1)).toBe(true)
    const renderer = await f.create()
    expect(f.workers).toHaveLength(2)
    renderer.terminate(); renderer.terminate()
    expect(f.workers[1].terminate).toHaveBeenCalledTimes(1)
})

it.each(["first-loading", "second-loading", "play"])("releases polling and worker on %s failure", async stage => {
    const f = setup(); const renderer = await f.create()
    const fault = new Error(`synthetic ${stage}`)
    if (stage === "first-loading") {f.commands.queryLoadingComplete.mockRejectedValueOnce(fault)}
    if (stage === "second-loading") {f.commands.queryLoadingComplete.mockResolvedValueOnce(true).mockRejectedValueOnce(fault)}
    if (stage === "play") {f.commands.play.mockImplementationOnce(() => {throw fault})}
    await expect(renderer.render({}, 0, 960, new DefaultObservableValue(0))).rejects.toBe(fault)
    expect(f.polling.terminate).toHaveBeenCalledTimes(1)
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(f.protocol.render).not.toHaveBeenCalled()
})


it("preserves initialization failure when subscription cleanup also fails", async () => {
    const f = setup()
    const primary = new Error("primary initialize")
    f.protocol.initialize.mockRejectedValueOnce(primary)
    f.live.terminate.mockImplementationOnce(() => {throw new Error("secondary cleanup")})
    await expect(f.create()).rejects.toBe(primary)
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(f.ports.every(port => port.close.mock.calls.length === 1)).toBe(true)
})
