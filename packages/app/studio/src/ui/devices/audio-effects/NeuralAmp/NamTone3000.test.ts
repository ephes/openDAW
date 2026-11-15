import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {Errors, UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NeuralAmpDeviceBox, NeuralAmpModelBox} from "@opendaw/studio-boxes"
import {NeuralAmpDeviceBoxAdapter, ProjectSkeleton} from "@opendaw/studio-adapters"
import {Workers} from "@opendaw/studio-core"
import {NamTone3000} from "./NamTone3000"

vi.mock("@opendaw/studio-core", () => ({Workers: {Opfs: {exists: vi.fn(async () => true), read: vi.fn()}}}))
vi.mock("./Tone3000Dialog", () => ({showTone3000Dialog() {}}))
afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks()})
const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    const box = editing.modify(() => {
        const unit = AudioUnitBox.create(graph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        const model = NeuralAmpModelBox.create(graph, UUID.generate(), box => box.packId.setValue("1"))
        return NeuralAmpDeviceBox.create(graph, UUID.generate(), box => {box.host.refer(unit.audioEffects); box.model.refer(model)})
    }).unwrap()
    editing.clear()
    const controller = new AbortController()
    const run = () => NamTone3000.loadModelFromPack("1", 1, "Next", graph, editing,
        {box} as NeuralAmpDeviceBoxAdapter, "Pack", controller.signal)
    return {box, graph, editing, controller, run}
}
it.each(["read", "hash", "delete"])("does not install after retirement during %s", async stage => {
    const f = fixture(), gate = Promise.withResolvers<never>()
    if (stage === "hash") {
        vi.mocked(Workers.Opfs.read).mockResolvedValue(new TextEncoder().encode("{}"))
        vi.spyOn(UUID, "sha256").mockReturnValue(gate.promise)
    } else {
        vi.mocked(Workers.Opfs.read).mockReturnValue(gate.promise)
        vi.spyOn(UUID, "sha256").mockResolvedValue(UUID.generate())
    }
    const pending = f.run()
    await vi.waitFor(() => expect(stage === "hash" ? UUID.sha256 : Workers.Opfs.read).toHaveBeenCalled())
    if (stage === "delete") {f.editing.modify(() => f.box.delete())}
    else {f.controller.abort(Errors.AbortError)}
    const before = new Uint8Array(f.graph.toArrayBuffer())
    gate.resolve((stage === "hash" ? UUID.generate() : new TextEncoder().encode("{}")) as never)
    await expect(pending).rejects.toSatisfy(Errors.isAbort)
    expect(new Uint8Array(f.graph.toArrayBuffer())).toEqual(before)
})
