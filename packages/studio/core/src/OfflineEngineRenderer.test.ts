import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Errors, Option} from "@opendaw/lib-std"
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

it("honors pre-abort before loading or polling and preserves the caller's handler", async () => {
    const f = setup(); const renderer = await f.create()
    const controller = new AbortController(); const caller = vi.fn()
    controller.signal.onabort = caller; controller.abort()
    await expect(renderer.render({}, 0, 960, new DefaultObservableValue(0), controller.signal)).rejects.toBe(Errors.AbortError)
    expect(controller.signal.onabort).toBe(caller)
    expect(caller).toHaveBeenCalledTimes(1)
    expect(f.commands.queryLoadingComplete).not.toHaveBeenCalled()
    expect(AnimationFrame.add).not.toHaveBeenCalled()
    expect(f.protocol.render).not.toHaveBeenCalled()
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
})

it("cancels pending loading promptly without replacing caller abort listeners", async () => {
    const f = setup(); const renderer = await f.create()
    const controller = new AbortController(); const caller = vi.fn()
    controller.signal.onabort = caller
    f.commands.queryLoadingComplete.mockReturnValueOnce(new Promise(() => {}))
    const running = renderer.render({}, 0, 960, new DefaultObservableValue(0), controller.signal)
    const rejection = expect(running).rejects.toBe(Errors.AbortError)
    controller.abort(); await rejection
    expect(caller).toHaveBeenCalledTimes(1)
    expect(f.polling.terminate).toHaveBeenCalledTimes(1)
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(f.protocol.render).not.toHaveBeenCalled()
})

it.each(["success", "failure"])("unsubscribes abort after %s and ignores late abort or duplicate termination", async outcome => {
    const f = setup(); const renderer = await f.create()
    const controller = new AbortController(); const caller = vi.fn()
    controller.signal.onabort = caller
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    if (outcome === "failure") {f.protocol.render.mockRejectedValueOnce(new Error("synthetic render"))}
    const running = renderer.render({}, 0, 960, new DefaultObservableValue(0), controller.signal)
    if (outcome === "success") {expect((await running).numberOfFrames).toBe(4)}
    else {await expect(running).rejects.toThrow("synthetic render")}
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    controller.abort(); renderer.stop(); renderer.terminate(); renderer.terminate()
    expect(caller).toHaveBeenCalledTimes(1)
    expect(f.commands.stop).not.toHaveBeenCalled()
    expect(f.protocol.stop).not.toHaveBeenCalled()
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
})

import {EngineToClient} from "@opendaw/studio-adapters"
import {DefaultSoundfontLoader} from "./soundfont/DefaultSoundfontLoader"
import {GlobalSoundfontLoaderManager} from "./soundfont/GlobalSoundfontLoaderManager"
import {SoundfontStorage} from "./soundfont/SoundfontStorage"
import {ExternalLib} from "./ExternalLib"

it("unsubscribes repeated real cached soundfont errors and permits a loaded retry", async () => {
    const f = setup(); const renderer = await f.create()
    vi.spyOn(SoundfontStorage, "get").mockReturnValue({load: vi.fn().mockRejectedValue(new Error("timeoout synthetic"))} as unknown as SoundfontStorage)
    const loader = new DefaultSoundfontLoader({} as GlobalSoundfontLoaderManager, UUID.generate())
    await vi.waitFor(() => expect(loader.state.type).toBe("error"))
    f.source.soundfontManager.getOrCreate.mockReturnValue(loader)
    const original = loader.subscribe.bind(loader)
    let active = 0
    vi.spyOn(loader, "subscribe").mockImplementation(observer => {
        active++
        const subscription = original(observer)
        let closed = false
        return {terminate: () => {if (!closed) {closed = true; active--; subscription.terminate()}}}
    })
    const api = f.executors[0] as EngineToClient
    for (let i=0; i<3; i++) {
        await expect(api.fetchSoundfont(loader.uuid)).rejects.toThrow("synthetic")
        expect(active).toBe(0)
    }
    vi.mocked(SoundfontStorage.get).mockReturnValue({load: vi.fn().mockResolvedValue([new ArrayBuffer(1), {name:"Synthetic"}])} as unknown as SoundfontStorage)
    vi.spyOn(ExternalLib, "SoundFont2").mockResolvedValue({status:"resolved", value:class {}} as never)
    loader.invalidate()
    await vi.waitFor(() => expect(loader.state.type).toBe("loaded"))
    await expect(api.fetchSoundfont(loader.uuid)).resolves.toBe(loader.soundfont.unwrap())
    expect(active).toBe(0)
    renderer.terminate()
})

it.each(["error", "loaded"] as const)("cleans synchronous audio %s subscription", async type => {
    const f = setup(); const renderer = await f.create()
    const terminate = vi.fn()
    const data = {numberOfFrames: 4}
    f.source.sampleManager.getOrCreate.mockReturnValue({data: Option.wrap(data), subscribe(observer: (state: unknown) => void) {
        observer(type === "error" ? {type, reason:"synthetic audio"} : {type}); return {terminate}
    }})
    const api = f.executors[0] as EngineToClient
    const promise = api.fetchAudio(UUID.generate())
    if (type === "error") {await expect(promise).rejects.toThrow("synthetic audio")}
    else {await expect(promise).resolves.toBe(data)}
    expect(terminate).toHaveBeenCalledTimes(1)
    renderer.terminate()
})


it("releases pending loader subscriptions on termination", async () => {
    const f = setup(); const renderer = await f.create()
    const terminate = vi.fn()
    f.source.sampleManager.getOrCreate.mockReturnValue({subscribe: () => ({terminate})})
    const api = f.executors[0] as EngineToClient
    void api.fetchAudio(UUID.generate())
    renderer.terminate(); renderer.terminate()
    expect(terminate).toHaveBeenCalledTimes(1)
})

it("preserves the render error and terminates after polling cleanup failure", async () => {
    const f = setup(); const renderer = await f.create()
    const primary = new Error("primary render")
    f.protocol.render.mockRejectedValueOnce(primary)
    f.polling.terminate.mockImplementationOnce(() => {throw new Error("secondary polling cleanup")})
    await expect(renderer.render({}, 0, 960, new DefaultObservableValue(0))).rejects.toBe(primary)
    expect(f.workers[0].terminate).toHaveBeenCalledTimes(1)
})
