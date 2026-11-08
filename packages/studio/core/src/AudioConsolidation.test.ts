import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Maybe, Option, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {RegionCollection} from "@opendaw/lib-dsp"
import {Box, BoxConstruct, BoxEditing, BoxGraph, Float32Field, NoPointers, StringField, UnreferenceableType, VertexVisitor} from "@opendaw/lib-box"
import {AudioRegionBoxAdapter} from "@opendaw/studio-adapters"
import {AudioConsolidation} from "./AudioConsolidation"
import {AudioContentFactory, AudioFileBoxFactory, OfflineEngineRenderer, Project, SampleService} from "./index"

vi.mock("./index", () => ({
    AudioContentFactory: {createNotStretchedRegion: vi.fn()},
    AudioFileBoxFactory: {createModifier: vi.fn()},
    OfflineEngineRenderer: {create: vi.fn()}, Workers: {Transients: {}}
}))

type Fields = {1: Float32Field, 2: Float32Field, 3: StringField}
class FixtureBox extends Box<UnreferenceableType, Fields> {
    static create(graph: BoxGraph, uuid: UUID.Bytes, init?: (box: FixtureBox) => void): FixtureBox {
        return graph.stageBox(new FixtureBox({graph, uuid, name: "FixtureBox", pointerRules: NoPointers}), init)
    }
    private constructor(props: BoxConstruct<UnreferenceableType>) {super(props)}
    protected initializeFields(): Fields {
        const props = {parent: this, deprecated: false, pointerRules: NoPointers}
        return {1: Float32Field.create({...props, fieldKey: 1, fieldName: "start"}, "any", "s"),
            2: Float32Field.create({...props, fieldKey: 2, fieldName: "end"}, "any", "s"),
            3: StringField.create({...props, fieldKey: 3, fieldName: "name"}, "")}
    }
    accept<R>(_visitor: VertexVisitor<R>): Maybe<R> {return undefined}
    get tags(): Readonly<Record<string, string | number | boolean>> {return {}}
    get startInSeconds() {return this.getField(1)}
    get endInSeconds() {return this.getField(2)}
    get fileName() {return this.getField(3)}
}
const fixture = (ranges = [[0, 16], [4, 8], [6, 10]], selection = [0, 2]) => {
    const graph = new BoxGraph(Option.wrap((_name, graph, uuid, init) => FixtureBox.create(graph, uuid, init)))
    const editing = new BoxEditing(graph)
    const trackBox = editing.modify(() => FixtureBox.create(graph, UUID.generate())).unwrap()
    const boxes = ranges.map(([start, end]) => editing.modify(() => FixtureBox.create(graph, UUID.generate(), box => {
        box.startInSeconds.setValue(start)
        box.endInSeconds.setValue(end)
        box.fileName.setValue("synthetic")
    })).unwrap())
    const collection = RegionCollection.create<AudioRegionBoxAdapter>(RegionCollection.Comparator)
    const track = {box: trackBox, audioUnit: trackBox, regions: {collection}}
    const regions = boxes.map(box => ({
        uuid: box.address.uuid, box, trackBoxAdapter: Option.wrap(track),
        get position() {return box.startInSeconds.getValue()},
        get complete() {return box.endInSeconds.getValue()},
        get duration() {return box.endInSeconds.getValue() - box.startInSeconds.getValue()},
        label: "Synthetic", file: {fileName: "synthetic"}
    })) as unknown as AudioRegionBoxAdapter[]
    regions.forEach(region => collection.add(region))
    const copiedGraph = new BoxGraph(Option.wrap((_name, graph, uuid, init) => FixtureBox.create(graph, uuid, init)))
    copiedGraph.fromArrayBuffer(graph.toArrayBuffer(), false)
    const copied = {boxGraph: copiedGraph, terminate: vi.fn()}
    const renderer = {waitForLoading: vi.fn().mockResolvedValue(undefined), setPosition: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), terminate: vi.fn(),
        step: vi.fn(async (count: number) => [Float32Array.from({length: count}, (_, i) => i / 100), new Float32Array(count)])}
    vi.mocked(OfflineEngineRenderer.create).mockResolvedValue(renderer as unknown as OfflineEngineRenderer)
    vi.mocked(AudioFileBoxFactory.createModifier).mockResolvedValue(() => FixtureBox.create(graph, UUID.generate()) as never)
    vi.mocked(AudioContentFactory.createNotStretchedRegion).mockImplementation(() => FixtureBox.create(graph, UUID.generate()) as never)
    const project = {boxGraph: graph, editing, tempoMap: {intervalToSeconds: (a: number, b: number) => b - a},
        copy: vi.fn(() => copied), trackUserCreatedSample: vi.fn()}
    const sampleService = {audioContext: {sampleRate: 10}, importFile: vi.fn(async () => ({uuid: UUID.toString(UUID.generate()), name: "Synthetic", duration: 16}))}
    return {graph, editing, regions, boxes, trackBox, copied, renderer, project, sampleService,
        run: (signal?: AbortSignal) => AudioConsolidation.flatten(project as unknown as Project, sampleService as unknown as SampleService, selection.map(index => regions[index]), signal)}
}

beforeEach(() => {
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({terminate: vi.fn()} as never)
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined as never)
})
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})

it.each([
    [[0, 16], [2, 3], [4, 8]],
    [[0, 16], [2, 3], [0, 8]],
    [[0, 8], [2, 3], [12, 16]]
])("renders the entire selected union %j", async (a, b, c) => {
    const f = fixture([a, b, c])
    await f.run()
    expect(f.renderer.step).toHaveBeenCalledWith(160)
    const data = vi.mocked(AudioFileBoxFactory.createModifier).mock.calls[0][2]
    expect(data.numberOfFrames).toBe(160)
    expect(data.frames[0][159]).toBeCloseTo(1.59)
})

it("preserves unselected overlap and restores selected boxes in one undo", async () => {
    const f = fixture()
    const original = f.boxes[1].toArrayBuffer()
    await f.run()
    expect(f.copied.boxGraph.findBox(f.regions[1].uuid).isEmpty()).toBe(true)
    expect(f.graph.findBox(f.regions[1].uuid).unwrap().toArrayBuffer()).toEqual(original)
    expect(f.graph.findBox(f.regions[0].uuid).isEmpty()).toBe(true)
    expect(f.graph.findBox(f.regions[2].uuid).isEmpty()).toBe(true)
    expect(f.editing.undo()).toBe(true)
    expect(f.regions.every(r => f.graph.findBox(r.uuid).nonEmpty())).toBe(true)
})

it.each([[-2, 20], [0, 20]])("excludes earlier/equal-start unselected overlap %j", async (start, end) => {
    const f = fixture([[start, end], [0, 16], [4, 8]], [1, 2])
    await f.run()
    expect(f.copied.boxGraph.findBox(f.regions[0].uuid).isEmpty()).toBe(true)
    expect(f.graph.findBox(f.regions[0].uuid).nonEmpty()).toBe(true)
})

it("refuses pre-cancelled work before copying or creating a renderer", async () => {
    const f = fixture()
    const controller = new AbortController(); controller.abort()
    await f.run(controller.signal)
    expect(f.project.copy).not.toHaveBeenCalled()
    expect(OfflineEngineRenderer.create).not.toHaveBeenCalled()
    expect(f.sampleService.importFile).not.toHaveBeenCalled()
    expect(f.project.trackUserCreatedSample).not.toHaveBeenCalled()
})

it.each(["create", "loading", "play", "step", "import", "modifier"] as const)("cancels during %s before publication", async stage => {
    const f = fixture()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const gate = Promise.withResolvers<never>()
    const target = stage === "create" ? vi.mocked(OfflineEngineRenderer.create)
        : stage === "loading" ? f.renderer.waitForLoading
        : stage === "play" ? f.renderer.play
        : stage === "step" ? f.renderer.step
        : stage === "import" ? f.sampleService.importFile : vi.mocked(AudioFileBoxFactory.createModifier)
    target.mockReturnValueOnce(gate.promise)
    const running = f.run(controller.signal)
    await vi.waitFor(() => expect(target).toHaveBeenCalled())
    controller.abort()
    gate.reject(new DOMException("cancelled", "AbortError"))
    await running
    expect(f.project.trackUserCreatedSample).not.toHaveBeenCalled()
    expect(f.regions.every(r => f.graph.findBox(r.uuid).nonEmpty())).toBe(true)
    if (stage !== "create") {expect(f.renderer.stop).toHaveBeenCalledTimes(1)}
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
})

it.each(["move", "trim", "delete", "track", "routing"])("rejects stale flatten after %s edit", async change => {
    const f = fixture()
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof f.renderer.step>>>()
    f.renderer.step.mockReturnValueOnce(gate.promise)
    const running = f.run()
    await vi.waitFor(() => expect(f.renderer.step).toHaveBeenCalled())
    f.editing.modify(() => {
        if (change === "move") {f.boxes[0].startInSeconds.setValue(2)}
        if (change === "trim") {f.boxes[0].endInSeconds.setValue(12)}
        if (change === "delete") {f.boxes[0].delete()}
        if (change === "track") {f.trackBox.delete()}
        if (change === "routing") {f.trackBox.fileName.setValue("changed routing")}
    })
    const current = f.graph.toArrayBuffer()
    gate.resolve([new Float32Array(160), new Float32Array(160)])
    await running
    expect(f.graph.toArrayBuffer()).toEqual(current)
    expect(f.sampleService.importFile).not.toHaveBeenCalled()
    expect(f.project.trackUserCreatedSample).not.toHaveBeenCalled()
    expect(RuntimeNotifier.info).toHaveBeenCalledWith(expect.objectContaining({message: expect.stringContaining("retry")}))
})

it("settles cancellation while loading is still pending", async () => {
    const f = fixture()
    const controller = new AbortController()
    f.renderer.waitForLoading.mockReturnValueOnce(new Promise(() => {}))
    const running = f.run(controller.signal)
    await vi.waitFor(() => expect(f.renderer.waitForLoading).toHaveBeenCalled())
    controller.abort(); await running
    expect(f.renderer.stop).toHaveBeenCalledTimes(1)
    expect(f.renderer.terminate).toHaveBeenCalledTimes(1)
    expect(f.sampleService.importFile).not.toHaveBeenCalled()
})

it("disposes a renderer returned after cancellation without publishing", async () => {
    const f = fixture()
    const controller = new AbortController()
    const gate = Promise.withResolvers<OfflineEngineRenderer>()
    vi.mocked(OfflineEngineRenderer.create).mockReturnValueOnce(gate.promise)
    const running = f.run(controller.signal)
    controller.abort(); await running
    gate.resolve(f.renderer as unknown as OfflineEngineRenderer)
    await vi.waitFor(() => expect(f.renderer.terminate).toHaveBeenCalledTimes(1))
    expect(f.project.trackUserCreatedSample).not.toHaveBeenCalled()
    expect(f.sampleService.importFile).not.toHaveBeenCalled()
})


it("releases operation resources before waiting for failure acknowledgement", async () => {
    const f = fixture()
    f.renderer.step.mockRejectedValueOnce(new Error("synthetic render failure"))
    const notice = Promise.withResolvers<void>()
    vi.mocked(RuntimeNotifier.info).mockReturnValueOnce(notice.promise as never)
    const running = f.run()
    await vi.waitFor(() => expect(RuntimeNotifier.info).toHaveBeenCalled())
    try {
        expect(f.renderer.terminate).toHaveBeenCalledTimes(1)
        expect(f.copied.terminate).toHaveBeenCalledTimes(1)
        expect(vi.mocked(RuntimeNotifier.progress).mock.results[0].value.terminate).toHaveBeenCalledTimes(1)
    } finally {notice.resolve(); await running}
})

it.each(["copy", "render", "import", "modifier"])("releases operation resources after %s failure and permits retry", async stage => {
    const f = fixture()
    const fault = new Error(`synthetic ${stage} failure`)
    if (stage === "copy") {f.project.copy.mockImplementationOnce(() => {throw fault})}
    if (stage === "render") {f.renderer.step.mockRejectedValueOnce(fault)}
    if (stage === "import") {f.sampleService.importFile.mockRejectedValueOnce(fault)}
    if (stage === "modifier") {vi.mocked(AudioFileBoxFactory.createModifier).mockRejectedValueOnce(fault)}
    const current = f.graph.toArrayBuffer()
    await f.run()
    expect(f.graph.toArrayBuffer()).toEqual(current)
    expect(RuntimeNotifier.info).toHaveBeenCalledWith(expect.objectContaining({message: String(fault)}))
    if (stage !== "copy") {
        expect(f.copied.terminate).toHaveBeenCalledTimes(1)
        expect(vi.mocked(RuntimeNotifier.progress).mock.results[0].value.terminate).toHaveBeenCalledTimes(1)
    }
    await f.run()
    expect(f.project.trackUserCreatedSample).toHaveBeenCalledTimes(1)
})

it("preserves the primary failure and releases the remaining owners when renderer cleanup throws", async () => {
    const f = fixture()
    f.renderer.step.mockRejectedValueOnce(new Error("primary render failure"))
    f.renderer.terminate.mockImplementationOnce(() => {throw new Error("secondary cleanup failure")})
    await expect(f.run()).resolves.toBeUndefined()
    expect(f.copied.terminate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(RuntimeNotifier.progress).mock.results[0].value.terminate).toHaveBeenCalledTimes(1)
    expect(RuntimeNotifier.info).toHaveBeenCalledWith(expect.objectContaining({message: expect.stringContaining("primary render failure")}))
})
