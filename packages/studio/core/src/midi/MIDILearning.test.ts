import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {RuntimeNotifier, UUID} from "@opendaw/lib-std"
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
    const registration = {terminate: vi.fn()}
    const adapter = {registerMidiControl: vi.fn(() => registration), setUnitValue: vi.fn()}
    const learning = new MIDILearning({boxGraph, editing,
        parameterFieldAdapters: {get: () => adapter}} as unknown as Project)
    learning.followUser(owner)
    let grant!: () => void
    vi.spyOn(MidiDevices, "canRequestMidiAccess").mockReturnValue(true)
    vi.spyOn(MidiDevices, "requestPermission").mockImplementation(() => new Promise<undefined>(resolve => {grant = () => resolve(undefined)}))
    const listeners = new Set<(event: MIDIMessageEvent) => void>()
    const subscribe = vi.spyOn(MidiDevices, "subscribeMessageEvents").mockImplementation(listener => {
        listeners.add(listener)
        return {terminate: () => {listeners.delete(listener)}}
    })
    const info = vi.spyOn(RuntimeNotifier, "info").mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal("MIDIInput", class extends EventTarget {})
    const send = () => {
        const event = new MessageEvent("midimessage", {data: new Uint8Array([0xb0, 7, 64])}) as MIDIMessageEvent
        Array.from(listeners).forEach(listener => listener(event))
    }
    const addController = () => editing.modify(() => MIDIControllerBox.create(boxGraph, UUID.generate(), box => {
        box.controllers.refer(owner)
        box.parameter.refer(device.volume)
        box.controlId.setValue(7)
    })).unwrap()
    return {boxGraph, editing, rootBox, device, owner, learning, adapter, registration, subscribe,
        info, listeners, send, addController, grant: () => grant()}
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
