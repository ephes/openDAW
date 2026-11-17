import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Errors, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NeuralAmpDeviceBox, NeuralAmpModelBox} from "@opendaw/studio-boxes"
import {NeuralAmpDeviceBoxAdapter, ProjectSkeleton} from "@opendaw/studio-adapters"
import {Workers} from "@opendaw/studio-core"
import {NamTone3000} from "./NamTone3000"
import {selectToneUrl} from "./ToneSelection"
import {showTone3000Dialog} from "./Tone3000Dialog"

vi.mock("@opendaw/studio-core", () => ({Workers: {Opfs: {exists: vi.fn(async () => false), read: vi.fn(), write: vi.fn(async () => {})}}}))
vi.mock("./Tone3000Dialog", () => ({showTone3000Dialog: vi.fn(async () => {})}))
vi.mock("./ToneSelection", () => ({selectToneUrl: vi.fn(async () => "https://example.test/tone")}))
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()})
const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const box = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const model = NeuralAmpModelBox.create(boxGraph, UUID.generate())
        return NeuralAmpDeviceBox.create(boxGraph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.model.refer(model)})
    }).unwrap()
    const adapter = {box} as NeuralAmpDeviceBoxAdapter
    const files = new Map<string, Uint8Array>()
    vi.mocked(Workers.Opfs.exists).mockImplementation(async path => files.has(path))
    vi.mocked(Workers.Opfs.read).mockImplementation(async path => files.get(path)!)
    vi.mocked(Workers.Opfs.write).mockImplementation(async (path, bytes) => {files.set(path, bytes)})
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => new Response(String(url).endsWith("tone")
        ? JSON.stringify({id: 1, title: "Synthetic", updated_at: "v1", models: [{id: 1, name: "New", size: "standard", model_url: "https://example.test/model"}]})
        : JSON.stringify({version: "0.5.4", architecture: "WaveNet", config: {}, weights: [1]}))))
    return {box, boxGraph, editing, adapter, run: () => NamTone3000.browse(boxGraph, editing, adapter)()}
}
it.each(["selection", "hash"])("fences removed or changed devices and newer browse intents during %s", async stage => {
    for (const action of ["delete", "change", "supersede"] as const) {
        const f = fixture(), gate = Promise.withResolvers<never>()
        if (stage === "selection") {vi.mocked(selectToneUrl).mockReturnValueOnce(gate.promise)}
        else {vi.spyOn(UUID, "sha256").mockReturnValueOnce(gate.promise)}
        const pending = f.run()
        await vi.waitFor(() => expect(stage === "selection" ? selectToneUrl : UUID.sha256).toHaveBeenCalled())
        if (action === "delete") {f.editing.modify(() => f.box.delete())}
        if (action === "change") {f.editing.modify(() => {const old = f.box.model.targetVertex.unwrap().box; f.box.model.refer(NeuralAmpModelBox.create(f.boxGraph, UUID.generate())); old.unstage()})}
        if (action === "supersede") {
            vi.mocked(showTone3000Dialog).mockRejectedValueOnce(Errors.AbortError)
            await f.run()
        }
        const before = new Uint8Array(f.boxGraph.toArrayBuffer())
        gate.resolve((stage === "selection" ? "https://example.test/tone" : UUID.generate()) as never)
        await pending
        expect(new Uint8Array(f.boxGraph.toArrayBuffer())).toEqual(before)
        vi.restoreAllMocks(); vi.clearAllMocks()
    }
})
it("imports once when the captured device and target remain current", async () => {
    const f = fixture()
    await f.run()
    expect(f.box.model.targetVertex.unwrap().box).toBeInstanceOf(NeuralAmpModelBox)
    expect((f.box.model.targetVertex.unwrap().box as NeuralAmpModelBox).label.getValue()).toBe("Synthetic — New")
})
