import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {BoxEditing} from "@opendaw/lib-box"
import {Files} from "@opendaw/lib-dom"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {AudioUnitBox} from "@opendaw/studio-boxes"
import {Project, ProjectApi} from "@opendaw/studio-core"
import {AiDemux} from "./AiDemux"
import {ensureInference} from "./InferenceLoader"
import type {StudioService} from "./StudioService"

vi.hoisted(() => {
    globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode
    globalThis.CSSStyleSheet = class {cssRules = [{}]; replaceSync() {}} as unknown as typeof CSSStyleSheet
    document.adoptedStyleSheets = []
})
vi.mock("@/ui/components/dialogs.tsx", () => ({Dialogs: {show: vi.fn(async () => {})}}))
vi.mock("./InferenceLoader", () => ({ensureInference: vi.fn()}))
const settle = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve()}}
const decode = vi.fn(), close = vi.fn()
const stemOutput = () => Object.fromEntries(["drums", "bass", "other", "vocals"].map(name => [name, new Float32Array(4)]))
const fixture = (state = "running") => {
    const skeleton = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const graph = skeleton.boxGraph, editing = new BoxEditing(graph)
    const project = {boxGraph: graph, editing, skeleton, rootBox: skeleton.mandatoryBoxes.rootBox,
        userEditingManager: {audioUnit: {edit() {}}}} as unknown as Project
    Object.defineProperty(project, "api", {value: new ProjectApi(project)})
    const profile = {project}
    let current: typeof profile | null = profile
    const audioContext = {state, suspend: vi.fn(async () => {audioContext.state = "suspended"}),
        resume: vi.fn(async () => {audioContext.state = "running"})}
    const sampleService = {importFile: vi.fn(async ({name}: {name: string}) => ({uuid: UUID.toString(UUID.generate()), name,
        duration: 4 / 44100, sampleRate: 44100, numberOfFrames: 4, numberOfChannels: 1}))}
    const sampleManager = {getAudioData: vi.fn(async () => ({}))}
    const service = {audioContext, sampleService, sampleManager,
        projectProfileService: {getValue: () => Option.wrap(current)},
        get project() {return current?.project}, get hasProfile() {return current !== null},
        get optProject() {return Option.wrap(current?.project)}} as unknown as StudioService
    const inference = {isCached: vi.fn(async () => true), preload: vi.fn(async () => {}), run: vi.fn(async () => stemOutput()),
        modelDescriptor: () => ({bytes: 1}), releaseTask: vi.fn(async () => {})}
    vi.mocked(ensureInference).mockResolvedValue(inference as never)
    const tracks = () => graph.boxes().filter(box => box instanceof AudioUnitBox).length - 1
    return {service, project, graph, editing, inference, sampleService, sampleManager, audioContext, tracks,
        switch: (next: Project | null) => {current = next === null ? null : {project: next}}}
}
beforeEach(() => {
    vi.spyOn(Files, "open").mockResolvedValue([{arrayBuffer: async () => new ArrayBuffer(4)} as File])
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate: vi.fn()} as never)
    decode.mockResolvedValue({numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array(4)})
    close.mockResolvedValue(undefined)
    vi.stubGlobal("AudioContext", class {decodeAudioData = decode; close = close})
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})
it("closes each failed decoder once and retains the decode error even when close fails", async () => {
    const f = fixture()
    decode.mockRejectedValue(new Error("original decode")); close.mockRejectedValue(new Error("close failure"))
    await AiDemux.run(f.service); await AiDemux.run(f.service)
    expect(close).toHaveBeenCalledTimes(2)
    expect(RuntimeNotifier.info).toHaveBeenLastCalledWith(expect.objectContaining({message: expect.stringContaining("original decode")}))
    decode.mockResolvedValue({numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array(4)})
    close.mockResolvedValue(undefined)
    await AiDemux.run(f.service)
    expect(close).toHaveBeenCalledTimes(3)
    expect(f.tracks()).toBe(4)
})
it("preserves an already suspended context", async () => {
    const f = fixture("suspended")
    await AiDemux.run(f.service)
    expect(f.audioContext.resume).not.toHaveBeenCalled()
})
it("restores playback only when the last overlapping owner finishes", async () => {
    const f = fixture(), a = Promise.withResolvers<ReturnType<typeof stemOutput>>(), b = Promise.withResolvers<ReturnType<typeof stemOutput>>()
    f.inference.run.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const runA = AiDemux.run(f.service), runB = AiDemux.run(f.service)
    await vi.waitFor(() => expect(f.inference.run).toHaveBeenCalledTimes(2))
    a.resolve(stemOutput()); await runA
    expect(f.audioContext.resume).not.toHaveBeenCalled()
    b.resolve(stemOutput()); await runB
    expect(f.audioContext.suspend).toHaveBeenCalledTimes(1)
    expect(f.audioContext.resume).toHaveBeenCalledTimes(1)
})
it.each(["inference", "import", "audio", "close"])("drops results when project changes during %s", async stage => {
    const f = fixture(), next = fixture().project, gate = Promise.withResolvers<never>()
    vi.mocked(ensureInference).mockResolvedValue(f.inference as never)
    if (stage === "inference" || stage === "close") {f.inference.run.mockReturnValueOnce(gate.promise)}
    if (stage === "import") {f.sampleService.importFile.mockReturnValueOnce(gate.promise)}
    if (stage === "audio") {f.sampleManager.getAudioData.mockReturnValueOnce(gate.promise)}
    const run = AiDemux.run(f.service)
    await vi.waitFor(() => expect(stage === "inference" || stage === "close" ? f.inference.run : stage === "import" ? f.sampleService.importFile : f.sampleManager.getAudioData).toHaveBeenCalled())
    const before = new Uint8Array(f.graph.toArrayBuffer()), nextBefore = new Uint8Array(next.boxGraph.toArrayBuffer())
    f.switch(stage === "close" ? null : next)
    gate.resolve((stage === "inference" || stage === "close" ? stemOutput() : stage === "import" ? {uuid: UUID.toString(UUID.generate()), name: "drums", duration: 4 / 44100} : {}) as never)
    await run; await settle()
    expect(new Uint8Array(f.graph.toArrayBuffer())).toEqual(before)
    expect(new Uint8Array(next.boxGraph.toArrayBuffer())).toEqual(nextBefore)
})
it("reports failed stems, retains imported samples and retries without duplicate tracks", async () => {
    const f = fixture()
    f.sampleService.importFile.mockImplementationOnce(f.sampleService.importFile.getMockImplementation()!)
        .mockRejectedValueOnce(new Error("bass import failed"))
    f.sampleManager.getAudioData.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("other audio unavailable"))
    await AiDemux.run(f.service)
    expect(f.tracks()).toBe(0)
    expect(RuntimeNotifier.info).toHaveBeenCalledWith(expect.objectContaining({message: expect.stringMatching(/bass:.*import failed[\s\S]*other:.*audio.*failed/)}))
    expect(f.sampleService.importFile).toHaveBeenCalledTimes(4)
    // A fresh attempt publishes the complete group once. Previously imported
    // samples stay in the library; no partial arrangement needs reconciliation.
    await AiDemux.run(f.service)
    expect(f.tracks()).toBe(4)
    expect(f.editing.undo()).toBe(true)
    expect(f.tracks()).toBe(0)
})
