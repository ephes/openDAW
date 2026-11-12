import {afterEach, expect, it, vi} from "vitest"
import {Address, BoxEditing} from "@opendaw/lib-box"
import {asDefined, RuntimeNotifier, UUID} from "@opendaw/lib-std"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {MIDIControllerBox, StereoToolDeviceBox, UserInterfaceBox} from "@opendaw/studio-boxes"
import type {Project} from "../project"
import {MIDILearning} from "./MIDILearning"
import {MidiDevices} from "./MidiDevices"

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

const setup = () => {
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioUnitBox, userInterfaceBoxes}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const device = editing.modify(() => StereoToolDeviceBox.create(boxGraph, UUID.generate(), box =>
        box.host.refer(primaryAudioUnitBox.audioEffects))).unwrap()
    const owner = userInterfaceBoxes[0].midiControllers
    const createAdapter = () => {
        const registration = {terminate: vi.fn()}
        return {registration, registerMidiControl: vi.fn(() => registration), setUnitValue: vi.fn()}
    }
    const adapter = createAdapter()
    const registration = adapter.registration
    const adapters = new Map<string, ReturnType<typeof createAdapter>>()
    const adapterOf = (address: Address) => {
        if (address.equals(device.volume.address)) {return adapter}
        const key = address.toString()
        if (!adapters.has(key)) {adapters.set(key, createAdapter())}
        return asDefined(adapters.get(key))
    }
    const learning = new MIDILearning({boxGraph, editing,
        parameterFieldAdapters: {get: adapterOf}} as unknown as Project)
    learning.followUser(owner)
    const grants: Array<() => void> = []
    vi.spyOn(MidiDevices, "canRequestMidiAccess").mockReturnValue(true)
    vi.spyOn(MidiDevices, "requestPermission").mockImplementation(() =>
        new Promise<undefined>(resolve => {grants.push(() => resolve(undefined))}))
    const listeners = new Set<(event: MIDIMessageEvent) => void>()
    const subscribe = vi.spyOn(MidiDevices, "subscribeMessageEvents").mockImplementation(listener => {
        listeners.add(listener)
        return {terminate: () => {listeners.delete(listener)}}
    })
    const info = vi.spyOn(RuntimeNotifier, "info").mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal("MIDIInput", class extends EventTarget {})
    const send = (controlId: number = 7) => {
        const event = new MessageEvent("midimessage", {data: new Uint8Array([0xb0, controlId, 64])}) as MIDIMessageEvent
        Array.from(listeners).forEach(listener => listener(event))
    }
    const addController = () => editing.modify(() => MIDIControllerBox.create(boxGraph, UUID.generate(), box => {
        box.controllers.refer(owner)
        box.parameter.refer(device.volume)
        box.controlId.setValue(7)
    })).unwrap()
    return {boxGraph, editing, rootBox, device, owner, learning, adapter, registration, adapterOf, subscribe,
        info, listeners, send, addController, grant: () => grants.splice(0).forEach(grant => grant())}
}

it.each(["terminate", "switch owner", "follow same owner", "delete target", "delete owner"])(
    "does not install learning after permission resolves following %s", async action => {
        const f = setup()
        const pending = f.learning.learnMIDIControls(f.device.volume)
        if (action === "terminate") {f.learning.terminate()}
        if (action === "switch owner") {
            const user = f.editing.modify(() => UserInterfaceBox.create(f.boxGraph, UUID.generate(), box =>
                box.root.refer(f.rootBox.users))).unwrap()
            f.learning.followUser(user.midiControllers)
        }
        if (action === "follow same owner") {f.learning.followUser(f.owner)}
        if (action === "delete target") {f.editing.modify(() => f.device.delete())}
        if (action === "delete owner") {f.editing.modify(() => f.owner.box.delete())}
        f.grant()
        await Promise.resolve()
        expect(f.subscribe).not.toHaveBeenCalled()
        expect(f.info).not.toHaveBeenCalled()
        expect(f.owner.pointerHub.incoming()).toHaveLength(0)
        await pending
        f.learning.terminate()
    })

it("still learns for the current attached owner and target", async () => {
    const f = setup()
    void f.learning.learnMIDIControls(f.device.volume)
    f.grant()
    await Promise.resolve()
    expect(f.listeners.size).toBe(1)
    f.send()
    expect(f.owner.pointerHub.incoming()).toHaveLength(1)
    expect(f.adapter.setUnitValue).toHaveBeenCalledWith(0.5)
    f.learning.terminate()
    expect(f.listeners.size).toBe(0)
})

it("refuses a target deleted while the learning dialog is open", async () => {
    const f = setup()
    void f.learning.learnMIDIControls(f.device.volume)
    f.grant()
    await Promise.resolve()
    f.editing.modify(() => f.device.delete())
    f.send()
    expect(f.owner.pointerHub.incoming()).toHaveLength(0)
    expect(f.listeners.size).toBe(0)
    f.learning.terminate()
})

it("retires the followed pointer subscription and cannot follow again after termination", () => {
    const f = setup()
    const controller = f.addController()
    expect(f.adapter.registerMidiControl).toHaveBeenCalledTimes(1)
    f.learning.terminate()
    f.learning.terminate()
    expect(f.registration.terminate).toHaveBeenCalledTimes(1)
    f.editing.modify(() => controller.delete())
    f.addController()
    f.learning.followUser(f.owner)
    f.addController()
    expect(f.adapter.registerMidiControl).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
})

it("keeps a single active learning attempt and retires the previous dialog", async () => {
    const f = setup()
    void f.learning.learnMIDIControls(f.device.volume)
    f.grant()
    await Promise.resolve()
    void f.learning.learnMIDIControls(f.device.panning)
    const firstSignal = f.info.mock.calls[0][0].abortSignal
    expect(firstSignal?.aborted).toBe(true)
    expect(f.listeners.size).toBe(0)
    f.grant()
    await Promise.resolve()
    expect(f.listeners.size).toBe(1)
    f.send()
    const incoming = f.owner.pointerHub.incoming()
    expect(incoming).toHaveLength(1)
    expect((incoming[0].box as MIDIControllerBox).parameter.targetAddress.unwrap().equals(f.device.panning.address))
        .toBe(true)
    expect(f.adapter.setUnitValue).not.toHaveBeenCalled()
    f.learning.terminate()
})

it("lets only the latest of overlapping permission requests install learning", async () => {
    const f = setup()
    void f.learning.learnMIDIControls(f.device.volume)
    void f.learning.learnMIDIControls(f.device.panning)
    f.grant()
    await Promise.resolve()
    expect(f.listeners.size).toBe(1)
    expect(f.info).toHaveBeenCalledTimes(1)
    f.send()
    expect(f.owner.pointerHub.incoming()).toHaveLength(1)
    expect(f.adapter.setUnitValue).not.toHaveBeenCalled()
    expect(f.adapterOf(f.device.panning.address).setUnitValue).toHaveBeenCalledWith(0.5)
    f.learning.terminate()
})

it("follows a controller retargeted to another parameter", () => {
    const f = setup()
    const controller = f.addController()
    f.editing.modify(() => controller.parameter.refer(f.device.panning))
    const panning = f.adapterOf(f.device.panning.address)
    expect(f.registration.terminate).toHaveBeenCalledTimes(1)
    expect(panning.registerMidiControl).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(1)
    f.send()
    expect(f.adapter.setUnitValue).not.toHaveBeenCalled()
    expect(panning.setUnitValue).toHaveBeenCalledWith(0.5)
    expect(f.learning.hasMidiConnection(f.device.panning.address)).toBe(true)
    expect(f.learning.hasMidiConnection(f.device.volume.address)).toBe(false)
    f.learning.terminate()
    expect(panning.registration.terminate).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
})

it("follows a changed controller channel", () => {
    const f = setup()
    const controller = f.addController()
    expect(f.subscribe).toHaveBeenLastCalledWith(expect.any(Function), 0)
    f.editing.modify(() => controller.deviceChannel.setValue(3))
    expect(f.subscribe).toHaveBeenLastCalledWith(expect.any(Function), 3)
    expect(f.listeners.size).toBe(1)
    expect(f.adapter.registerMidiControl).toHaveBeenCalledTimes(2)
    expect(f.registration.terminate).toHaveBeenCalledTimes(1)
    f.learning.terminate()
    expect(f.listeners.size).toBe(0)
})

it("does not route a controller deleted in the same transaction it was retargeted", () => {
    const f = setup()
    const controller = f.addController()
    f.editing.modify(() => {
        controller.parameter.refer(f.device.panning)
        controller.delete()
    })
    expect(f.listeners.size).toBe(0)
    expect(f.adapterOf(f.device.panning.address).registerMidiControl).not.toHaveBeenCalled()
    f.learning.terminate()
})
