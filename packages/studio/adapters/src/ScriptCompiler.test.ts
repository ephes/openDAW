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

it("preserves saved graph, parameters and samples on rejected installation", async () => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source() + "\n// @sample hit")
    const code = f.box.code.getValue(), label = f.box.label.getValue()
    const parameter = f.box.parameters.pointerHub.filter()[0].box
    const sample = f.box.samples.pointerHub.filter()[0].box
    f.addModule.mockRejectedValueOnce(new Error("install refused"))
    await expect(f.compiler.compile(f.context, f.editing, f.box, "// @label changed\nclass Processor {}")).rejects.toThrow("install refused")
    expect(f.box.code.getValue()).toBe(code)
    expect(f.box.label.getValue()).toBe(label)
    expect(f.box.parameters.pointerHub.filter()[0].box).toBe(parameter)
    expect(f.box.samples.pointerHub.filter()[0].box).toBe(sample)
})
it("waits for installation and discards superseded or externally edited attempts", async () => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source())
    const before = f.box.code.getValue()
    let finish!: () => void
    f.addModule.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
    const older = f.compiler.compile(f.context, f.editing, f.box, source("0.2"))
    expect(f.box.code.getValue()).toBe(before)
    await f.compiler.compile(f.context, f.editing, f.box, source("0.3"))
    const latest = f.box.code.getValue()
    finish()
    await older
    expect(f.box.code.getValue()).toBe(latest)
    f.addModule.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
    const pending = f.compiler.compile(f.context, f.editing, f.box, source("0.4"))
    f.editing.modify(() => f.box.code.setValue(latest + "\n// external edit"))
    finish(); await pending
    expect(f.box.code.getValue()).toBe(latest + "\n// external edit")
})

const evaluateModule = async (url: string) => {new Function(await (await fetch(url)).text())()}
const registryEntry = (f: ReturnType<typeof fixture>) =>
    (globalThis as typeof globalThis & {openDAW: {werkstattProcessors: Record<string, {
        update: number, create: new () => {version: number}
    }>}}).openDAW.werkstattProcessors[UUID.toString(f.box.address.uuid)]
const versioned = (version: number) => source() + `\nProcessor.prototype.version = ${version}`
it("fences reverse module completion and deliberately loads an older saved update", async () => {
    const f = fixture()
    f.addModule.mockImplementation(evaluateModule)
    await f.compiler.compile(f.context, f.editing, f.box, versioned(0))
    const saved = f.box.code.getValue()
    let finish!: () => Promise<void>
    f.addModule.mockImplementationOnce((url: string) => new Promise<void>((resolve, reject) => {
        finish = async () => {try {await evaluateModule(url); resolve()} catch (error) {reject(error)}}
    }))
    const older = f.compiler.compile(f.context, f.editing, f.box, versioned(1))
    await f.compiler.compile(f.context, f.editing, f.box, versioned(2))
    const latest = registryEntry(f).update
    await finish(); await older
    expect(registryEntry(f).update).toBe(latest)
    expect(new (registryEntry(f).create)().version).toBe(2)
    f.editing.modify(() => f.box.code.setValue(saved))
    const loader = ScriptCompiler.create({headerTag: "werkstatt", registryName: "werkstattProcessors", functionName: "test"})
    await loader.load(f.context, f.box)
    expect(new (registryEntry(f).create)().version).toBe(0)
})
it("does not replace the working registry when module evaluation throws", async () => {
    const f = fixture()
    f.addModule.mockImplementation(evaluateModule)
    await f.compiler.compile(f.context, f.editing, f.box, versioned(0))
    const working = registryEntry(f), saved = f.box.code.getValue()
    await expect(f.compiler.compile(f.context, f.editing, f.box, source() + '\nthrow new Error("evaluation refused")')).rejects.toThrow("evaluation refused")
    expect(registryEntry(f)).toBe(working)
    expect(f.box.code.getValue()).toBe(saved)
})

it("restores only its own activation if superseded while activation completes", async () => {
    const f = fixture()
    f.addModule.mockImplementation(evaluateModule)
    await f.compiler.compile(f.context, f.editing, f.box, versioned(0))
    const working = registryEntry(f), saved = f.box.code.getValue()
    let finish!: () => void
    f.addModule.mockImplementationOnce(evaluateModule).mockImplementationOnce(async (url: string) => {
        await evaluateModule(url)
        await new Promise<void>(resolve => {finish = resolve})
    })
    const pending = f.compiler.compile(f.context, f.editing, f.box, versioned(1))
    await vi.waitFor(() => expect(finish).toBeDefined())
    await expect(f.compiler.compile(f.context, f.editing, f.box, source() + '\nthrow new Error("latest failure")')).rejects.toThrow("latest failure")
    finish(); await pending
    expect(f.box.code.getValue()).toBe(saved)
    expect(registryEntry(f)).toBe(working)
})
it("restores its registry activation when graph publication fails", async () => {
    const f = fixture()
    f.addModule.mockImplementation(evaluateModule)
    await f.compiler.compile(f.context, f.editing, f.box, versioned(0))
    const working = registryEntry(f), saved = f.box.code.getValue()
    vi.spyOn(f.editing, "modify").mockImplementationOnce(() => {throw new Error("publication refused")})
    await expect(f.compiler.compile(f.context, f.editing, f.box, versioned(1))).rejects.toThrow("publication refused")
    expect(f.box.code.getValue()).toBe(saved)
    expect(registryEntry(f)).toBe(working)
})

it("does not resurrect an already retired activation during a later failed publication", async () => {
    const f = fixture()
    f.addModule.mockImplementation(evaluateModule)
    await f.compiler.compile(f.context, f.editing, f.box, versioned(0))
    const working = registryEntry(f), saved = f.box.code.getValue()
    let finishFirst!: () => void, finishSecond!: () => void
    f.addModule.mockImplementationOnce(evaluateModule).mockImplementationOnce(async (url: string) => {
        await evaluateModule(url); await new Promise<void>(resolve => {finishFirst = resolve})
    })
    const first = f.compiler.compile(f.context, f.editing, f.box, versioned(1))
    await vi.waitFor(() => expect(finishFirst).toBeDefined())
    f.addModule.mockImplementationOnce(evaluateModule).mockImplementationOnce(async (url: string) => {
        await evaluateModule(url); await new Promise<void>(resolve => {finishSecond = resolve})
    })
    const second = f.compiler.compile(f.context, f.editing, f.box, versioned(2))
    await vi.waitFor(() => expect(finishSecond).toBeDefined())
    finishFirst(); await first
    vi.spyOn(f.editing, "modify").mockImplementationOnce(() => {throw new Error("second publication refused")})
    finishSecond()
    await expect(second).rejects.toThrow("second publication refused")
    expect(f.box.code.getValue()).toBe(saved)
    expect(registryEntry(f)).toBe(working)
})

it.each(["invalid request", "edit then undo"])("retires an in-flight install after %s", async kind => {
    const f = fixture()
    await f.compiler.compile(f.context, f.editing, f.box, source())
    const saved = f.box.code.getValue()
    let finish!: () => void
    f.addModule.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
    const pending = f.compiler.compile(f.context, f.editing, f.box, source("0.2"))
    if (kind === "invalid request") {
        await expect(f.compiler.compile(f.context, f.editing, f.box, "// @param gain Infinity")).rejects.toThrow()
    } else {
        f.editing.modify(() => f.box.code.setValue(saved + "\n// external edit"))
        f.editing.undo()
    }
    finish(); await pending
    expect(f.box.code.getValue()).toBe(saved)
})

it("loads saved legacy declarations and lets a corrected script compile over them", async () => {
    const f = fixture()
    const legacy = "// @werkstatt js 1 1\n// @param release 0.5 0 5 exp s\n// @param gain\n// @param gain\nclass Processor {}"
    f.editing.modify(() => f.box.code.setValue(legacy))
    await expect(f.compiler.load(f.context, f.box)).resolves.toBeUndefined()
    await f.compiler.compile(f.context, f.editing, f.box, "// @param release 0.5 0.001 5 exp s\nclass Processor {}")
    expect(f.compiler.stripHeader(f.box.code.getValue())).toBe("// @param release 0.5 0.001 5 exp s\nclass Processor {}")
    expect(f.box.parameters.pointerHub.filter().length).toBe(1)
})

it.each([false, true])("appends the initial compile to the creation step only without an intervening edit (edit: %s)", async edited => {
    const f = fixture()
    let finish!: () => void
    f.addModule.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
    const pending = f.compiler.compile(f.context, f.editing, f.box, source(), true)
    await vi.waitFor(() => expect(finish).toBeDefined())
    if (edited) {f.editing.modify(() => f.box.label.setValue("user edit"))}
    finish(); await pending
    expect(f.box.parameters.pointerHub.filter().length).toBe(1)
    f.editing.undo()
    if (edited) {
        expect(f.box.label.getValue()).toBe("user edit")
        expect(f.box.code.getValue()).toBe("")
    } else {
        expect(f.editing.canUndo()).toBe(false)
    }
})
