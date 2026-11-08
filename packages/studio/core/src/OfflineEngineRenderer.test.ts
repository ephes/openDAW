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
