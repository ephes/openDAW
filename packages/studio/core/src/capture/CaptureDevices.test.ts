import {afterEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {CaptureMidiBox} from "@opendaw/studio-boxes"
import type {Project} from "../project"
import {CaptureDevices} from "./CaptureDevices"

const created: Array<{terminate: ReturnType<typeof vi.fn>}> = []
vi.mock("./CaptureMidi", () => ({
    CaptureMidi: class {
        readonly uuid: UUID.Bytes
        readonly terminate = vi.fn()
        constructor(_manager: unknown, audioUnitBox: {address: {uuid: UUID.Bytes}}) {
            this.uuid = audioUnitBox.address.uuid
            created.push(this)
        }
    }
}))
vi.mock("./CaptureAudio", () => ({CaptureAudio: class {}}))

afterEach(() => {created.length = 0})

const setup = () => {
    const {boxGraph, mandatoryBoxes: {rootBox, primaryAudioUnitBox}} =
        ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const devices = new CaptureDevices({rootBox} as unknown as Project)
    const changes = vi.fn()
    devices.subscribeChanges(changes)
    const attach = () => editing.modify(() => {
        primaryAudioUnitBox.capture.targetVertex.ifSome(({box}) => box.delete())
        primaryAudioUnitBox.capture.refer(CaptureMidiBox.create(boxGraph, UUID.generate()))
    })
    const detach = () => editing.modify(() => primaryAudioUnitBox.capture.targetVertex.ifSome(({box}) => box.delete()))
    detach()
    created.length = 0
    changes.mockClear()
    return {devices, changes, attach, detach, uuid: primaryAudioUnitBox.address.uuid}
}

it("notifies observers when a capture is detached from its audio unit", () => {
    const {devices, changes, attach, detach, uuid} = setup()
    attach()
    expect(devices.get(uuid).nonEmpty()).toBe(true)
    changes.mockClear()
    detach()
    expect(devices.get(uuid).isEmpty()).toBe(true)
    expect(created[0].terminate).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(devices.allCaptures()).toHaveLength(0)
})

it("keeps only the replacing capture and notifies observers", () => {
    const {devices, changes, attach, uuid} = setup()
    attach()
    changes.mockClear()
    attach()
    const current = created[created.length - 1]
    expect(devices.get(uuid).unwrap()).toBe(current)
    expect(devices.allCaptures()).toHaveLength(1)
    expect(created.filter(capture => capture !== current).every(capture => capture.terminate.mock.calls.length === 1))
        .toBe(true)
    expect(changes).toHaveBeenCalled()
})

it("retires the per-unit capture subscriptions at termination", () => {
    const {devices, changes, attach, detach, uuid} = setup()
    attach()
    devices.terminate()
    expect(created[0].terminate).toHaveBeenCalledTimes(1)
    changes.mockClear()
    attach()
    detach()
    attach()
    expect(created).toHaveLength(1)
    expect(devices.get(uuid).isEmpty()).toBe(true)
    expect(changes).not.toHaveBeenCalled()
})
