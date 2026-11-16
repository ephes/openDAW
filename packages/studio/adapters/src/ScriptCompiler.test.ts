import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {MIDIControllerBox, TrackBox, WerkstattDeviceBox, WerkstattParameterBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "./project/ProjectSkeleton"
import {ScriptCompiler} from "./ScriptCompiler"
import {ScriptDeclaration} from "./ScriptDeclaration"
import {ParameterAdapterSet} from "./ParameterAdapterSet"
import {ParameterFieldAdapters} from "./ParameterFieldAdapters"
import {BoxAdaptersContext} from "./BoxAdaptersContext"

const fixture = () => {
    const {boxGraph: graph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(graph)
    let box!: WerkstattDeviceBox
    editing.modify(() => {box = WerkstattDeviceBox.create(graph, UUID.generate(), box => box.host.refer(mandatoryBoxes.primaryAudioUnitBox.audioEffects))})
    const compiler = ScriptCompiler.create({headerTag: "werkstatt", registryName: "werkstattProcessors", functionName: "test"})
    const addModule = vi.fn().mockResolvedValue(undefined)
    const context = {audioWorklet: {addModule}} as unknown as BaseAudioContext
    return {graph, editing, box, compiler, context, addModule, mandatoryBoxes}
}
const source = (defaultValue = "0.5", unit = "%") => `// @param gain ${defaultValue} 0 1 linear ${unit}\nclass Processor {}`
afterEach(() => vi.restoreAllMocks())
it("keeps parameter addresses, values and automation/MIDI through default/unit edits and history", async () => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source())
    const parameter = f.box.parameters.pointerHub.filter()[0].box as WerkstattParameterBox
    let track!: TrackBox, midi!: MIDIControllerBox
    f.editing.modify(() => {
        parameter.value.setValue(0.7)
        track = TrackBox.create(f.graph, UUID.generate(), box => {box.target.refer(parameter.value); box.tracks.refer(f.mandatoryBoxes.primaryAudioUnitBox.tracks)})
        midi = MIDIControllerBox.create(f.graph, UUID.generate(), box => {box.parameter.refer(parameter.value); box.controllers.refer(f.mandatoryBoxes.userInterfaceBoxes[0].midiControllers)})
    })
    const registry = new ParameterFieldAdapters()
    const params = new ParameterAdapterSet({parameterFieldAdapters: registry, isMainThread: false,
        boxAdapters: {adapterFor: () => ({address: track.address})}} as unknown as BoxAdaptersContext)
    const binding = ScriptDeclaration.subscribeScriptParams(params, f.box.code, f.box.parameters)
    await f.compiler.compile(f.context, f.editing, f.box, source("0.25", "dB"))
    const check = (reset: number, unit: string) => {
        const current = f.box.parameters.pointerHub.filter()[0].box as WerkstattParameterBox
        expect(current.address.toString()).toBe(parameter.address.toString())
        expect(current.value.getValue()).toBeCloseTo(0.7)
        expect(current.defaultValue.getValue()).toBe(reset)
        expect(track.target.targetAddress.unwrap().toString()).toBe(parameter.value.address.toString())
        expect(midi.parameter.targetAddress.unwrap().toString()).toBe(parameter.value.address.toString())
        const adapter = params.parameterAt(parameter.value.address)
        expect(adapter.stringMapping.x(0.7).unit).toBe(unit)
    }
    check(0.25, "dB")
    f.editing.undo(); check(0.5, "%")
    f.editing.redo(); check(0.25, "dB")
    f.editing.modify(() => params.parameterAt(parameter.value.address).reset())
    expect(parameter.value.getValue()).toBe(0.25)
    binding.terminable.terminate(); params.terminate()
})
it("recreates a parameter when its numeric mapping domain changes", async () => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source())
    const address = f.box.parameters.pointerHub.filter()[0].box.address.toString()
    await f.compiler.compile(f.context, f.editing, f.box, source().replace("0 1 linear", "0 2 linear"))
    expect(f.box.parameters.pointerHub.filter()[0].box.address.toString()).not.toBe(address)
})

it.each(["Infinity", "1junk", "5", "0.5 -1 10 exp"])("rejects invalid numeric declaration %s before mutation", async value => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source())
    const code = f.box.code.getValue(), address = f.box.parameters.pointerHub.filter()[0].box.address.toString()
    f.addModule.mockClear()
    await expect(f.compiler.compile(f.context, f.editing, f.box, `// @param gain ${value}\nclass Processor {}`)).rejects.toThrow()
    expect(f.box.code.getValue()).toBe(code)
    expect(f.box.parameters.pointerHub.filter()[0].box.address.toString()).toBe(address)
    expect(f.addModule).not.toHaveBeenCalled()
})

it.each(["// @param gain 0.5\n// @param gain 0.75", "// @sample hit\n// @sample hit", "// @param gain\n// @sample gain"])(
    "refuses duplicate resources before install/reconciliation: %s", async declarations => {
        const f = fixture()
        await f.compiler.compile(f.context, f.editing, f.box, source())
        const before = f.box.code.getValue(), parameter = f.box.parameters.pointerHub.filter()[0].box
        f.addModule.mockClear()
        await expect(f.compiler.compile(f.context, f.editing, f.box, declarations + "\nclass Processor {}")).rejects.toThrow(/Duplicate.*line 2/)
        expect(f.box.code.getValue()).toBe(before)
        expect(f.box.parameters.pointerHub.filter()[0].box).toBe(parameter)
        expect(f.addModule).not.toHaveBeenCalled()
    })
it("reorders unique declarations without replacing their bindings", async () => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source() + "\n// @sample hit")
    const parameter = f.box.parameters.pointerHub.filter()[0].box
    const sample = f.box.samples.pointerHub.filter()[0].box
    await f.compiler.compile(f.context, f.editing, f.box, "// @sample hit\n" + source())
    expect(f.box.parameters.pointerHub.filter()[0].box).toBe(parameter)
    expect(f.box.samples.pointerHub.filter()[0].box).toBe(sample)
})
