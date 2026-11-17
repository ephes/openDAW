import {afterEach, expect, it, vi} from "vitest"
import {createElement} from "@opendaw/lib-jsx"
import {DefaultObservableValue, Notifier, MutableObservableOption, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {ProjectSkeleton, ScriptCompiler, ScriptDeclaration} from "@opendaw/studio-adapters"
import {BoxEditing} from "@opendaw/lib-box"
import {WerkstattDeviceBox, WerkstattParameterBox} from "@opendaw/studio-boxes"
import {IconSymbol} from "@opendaw/studio-enums"
import {ScriptDeviceEditor, ScriptDeviceEditorConfig} from "./ScriptDeviceEditor"
import {StudioService} from "@/service/StudioService"

vi.mock("@opendaw/lib-dom", async original => {
    const module = await original<typeof import("@opendaw/lib-dom")>()
    return {...module, Html: {...module.Html, adoptStyleSheet: () => "script-test"}}
})
vi.mock("@opendaw/studio-core", () => ({}))
vi.mock("@/ui/devices/DeviceEditor.tsx", () => ({DeviceEditor: ({populateControls}: {populateControls: () => HTMLElement}) => populateControls()}))
vi.mock("@/ui/devices/ControlBuilder", () => ({ControlBuilder: {}}))
vi.mock("@/ui/components/AutomationControl", () => ({AutomationControl: () => null}))
vi.mock("@/ui/devices/SampleSelector", () => ({SampleSelector: class {}}))
vi.mock("@/ui/devices/Column", () => ({Column: ({children}: {children: HTMLElement[]}) => <div>{children}</div>}))
vi.mock("@/ui/components/Button", () => ({Button: ({onClick}: {onClick: () => void}) => <button onclick={onClick}>Code</button>}))
vi.mock("@/ui/components/Icon", () => ({Icon: () => <span/>}))
vi.mock("@/ui/components/Checkbox", () => ({Checkbox: () => null}))

const flush = async () => {for (let i = 0; i < 30; i++) {await Promise.resolve()}}
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

const config = {headerTag: "werkstatt", registryName: "werkstattProcessors", functionName: "test"}
const setup = (storedCode: string, runtime?: {box: ScriptCompiler.ScriptDeviceBox, editing: BoxEditing, audioContext: BaseAudioContext}) => {
    const code = runtime?.box.code ?? new DefaultObservableValue(storedCode)
    const codeChanged = new Notifier<void>()
    code.subscribe(() => codeChanged.notify())
    const lifecycle = new Terminator()
    const uuid = UUID.generate()
    const box = runtime?.box ?? {code, parameters: {pointerHub: {incoming: () => [], subscribe: () => Terminable.Empty}},
        samples: {pointerHub: {incoming: () => [], subscribe: () => Terminable.Empty}}}
    const adapter = {box, codeChanged, uuid, parameters: {parameters: () => []}}
    let compile!: (code: string) => Promise<void>
    const service = {project: {editing: runtime?.editing ?? {}, midiLearning: {}}, audioContext: runtime?.audioContext ?? {},
        activeCodeEditor: new MutableObservableOption(),
        engine: {subscribeDeviceMessage: () => Terminable.Empty}, layout: {screen: {getValue: () => "studio"}},
        openCodeEditor: (state: {handler: {compile: typeof compile}}) => {compile = state.handler.compile}}
    const load = vi.fn().mockResolvedValue(undefined), compileCall = vi.fn().mockResolvedValue(undefined)
    const compiler = {stripHeader: (s: string) => s, load, compile: compileCall,
        initialize: () => code.getValue().length > 0 ? load() : compileCall()}
    if (runtime === undefined) {vi.spyOn(ScriptCompiler, "create").mockReturnValue(compiler as unknown as ReturnType<typeof ScriptCompiler.create>)}
    vi.spyOn(ScriptDeclaration, "parseGroups").mockReturnValue([])
    const mount = () => {
        const element = ScriptDeviceEditor({lifecycle, service: service as unknown as StudioService,
            adapter, deviceHost: {}, config: {compiler: config, defaultCode: "class Processor {}", icon: IconSymbol.Code,
                populateMeter: () => null, populateMenu() {}} as unknown as ScriptDeviceEditorConfig
        } as unknown as Parameters<typeof ScriptDeviceEditor>[0]) as HTMLElement
        return {element, error: element.querySelector<HTMLElement>(".error")!}
    }
    return {load, compileCall, code, lifecycle, mount, compile: (source: string) => compile(source)}
}

it.each(["load", "default", "external"])("owns %s failure, shows its error and clears it on explicit retry", async path => {
    const f = setup(path === "default" ? "" : "class Processor {}")
    const failing = path === "default" ? f.compileCall : f.load
    if (path !== "external") {failing.mockRejectedValueOnce(new Error("synthetic refusal"))}
    const {element, error} = f.mount()
    await flush()
    if (path === "external") {
        failing.mockRejectedValueOnce(new Error("synthetic refusal"))
        f.code.setValue("class Processor {} // external")
        await flush()
    }
    expect(error.classList.contains("hidden")).toBe(false)
    expect(error.title).toContain("synthetic refusal")
    element.querySelector<HTMLButtonElement>("button")!.click()
    await f.compile("class Processor {} // retry")
    expect(error.classList.contains("hidden")).toBe(true)
    expect(error.title).toBe("")
    f.lifecycle.terminate()
})

it("retires pending initialization callbacks on disposal", async () => {
    const f = setup("class Processor {}")
    const pending = Promise.withResolvers<void>()
    f.load.mockReturnValueOnce(pending.promise)
    const {error} = f.mount()
    f.lifecycle.terminate()
    pending.reject(new Error("late refusal"))
    await flush()
    expect(error.classList.contains("hidden")).toBe(true)
    expect(error.title).toBe("")
})

it("does not let an older initialization failure overwrite a newer explicit success", async () => {
    const f = setup("class Processor {}")
    const pending = Promise.withResolvers<void>()
    f.load.mockReturnValueOnce(pending.promise)
    const {element, error} = f.mount()
    element.querySelector<HTMLButtonElement>("button")!.click()
    await f.compile("class Processor {} // newer")
    pending.reject(new Error("stale refusal"))
    await flush()
    expect(error.classList.contains("hidden")).toBe(true)
    expect(error.title).toBe("")
    f.lifecycle.terminate()
})

const realDevice = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const box = editing.modify(() => WerkstattDeviceBox.create(boxGraph, UUID.generate(), box =>
        box.host.refer(mandatoryBoxes.primaryAudioUnitBox.audioEffects))).unwrap()
    vi.stubGlobal("URL", class extends URL {
        static createObjectURL() {return "blob:synthetic-worklet"}
        static revokeObjectURL() {}
    })
    const addModule = vi.fn().mockResolvedValue(undefined)
    const audioContext = {audioWorklet: {addModule}} as unknown as BaseAudioContext
    return {box, editing, audioContext, addModule}
}

it("keeps the real pending compile across editor disposal and remount", async () => {
    const runtime = realDevice()
    const compiler = ScriptCompiler.create(config)
    const initial = "// @param gain 0.5 0 1 linear\nclass Processor {}"
    await compiler.compile(runtime.audioContext, runtime.editing, runtime.box, initial)
    const first = setup("", runtime)
    const mounted = first.mount()
    await flush()
    mounted.element.querySelector<HTMLButtonElement>("button")!.click()
    const pending = Promise.withResolvers<void>()
    runtime.addModule.mockClear().mockReturnValueOnce(pending.promise)
    const publication = vi.spyOn(runtime.editing, "modify")
    const attempt = first.compile(initial.replace("gain 0.5", "gain 0.25"))
    first.lifecycle.terminate()
    const second = setup("", runtime)
    const remounted = second.mount()
    pending.resolve()
    await attempt; await flush()
    expect(compiler.stripHeader(runtime.box.code.getValue())).toContain("gain 0.25")
    expect((runtime.box.parameters.pointerHub.incoming()[0].box as WerkstattParameterBox).defaultValue.getValue()).toBe(0.25)
    expect(publication).toHaveBeenCalledOnce()
    expect(runtime.addModule).toHaveBeenCalledTimes(3)
    expect(remounted.error.classList.contains("hidden")).toBe(true)
    second.lifecycle.terminate()
})

it("shows a real initial addModule refusal and retries through the mounted code handler", async () => {
    const runtime = realDevice()
    runtime.addModule.mockRejectedValueOnce(new Error("addModule refused"))
    const f = setup("", runtime)
    const {element, error} = f.mount()
    await flush()
    expect(error.classList.contains("hidden")).toBe(false)
    expect(error.title).toContain("addModule refused")
    element.querySelector<HTMLButtonElement>("button")!.click()
    await f.compile("class Processor {} // retry")
    expect(error.classList.contains("hidden")).toBe(true)
    f.lifecycle.terminate()
})

it("reports an explicit compile refusal to its caller and permits retry", async () => {
    const f = setup("class Processor {}")
    const {element, error} = f.mount()
    await flush()
    element.querySelector<HTMLButtonElement>("button")!.click()
    f.compileCall.mockRejectedValueOnce(new Error("explicit refusal"))
    await expect(f.compile("class Processor {} // bad")).rejects.toThrow("explicit refusal")
    expect(error.classList.contains("hidden")).toBe(false)
    await f.compile("class Processor {} // retry")
    expect(error.classList.contains("hidden")).toBe(true)
    f.lifecycle.terminate()
})

it("still compiles through the code handler of a disposed editor without touching its retired UI", async () => {
    const f = setup("class Processor {}")
    const {element, error} = f.mount()
    await flush()
    element.querySelector<HTMLButtonElement>("button")!.click()
    // Opening the code screen remounts the device panel, which disposes this editor.
    f.lifecycle.terminate()
    await f.compile("class Processor {} // after disposal")
    expect(f.compileCall).toHaveBeenCalledTimes(1)
    expect(f.compileCall.mock.calls[0][3]).toBe("class Processor {} // after disposal")
    f.compileCall.mockRejectedValueOnce(new Error("refused after disposal"))
    await expect(f.compile("class Processor {} // bad")).rejects.toThrow("refused after disposal")
    expect(error.classList.contains("hidden")).toBe(true)
    expect(error.title).toBe("")
})
