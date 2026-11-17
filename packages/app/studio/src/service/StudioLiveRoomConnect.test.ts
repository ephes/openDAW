import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {DefaultObservableValue, MutableObservableOption, Option, RuntimeNotifier, Terminable, Terminator} from "@opendaw/lib-std"
import {YService} from "@opendaw/studio-core"
import type {Project} from "@opendaw/studio-core"
import type {StudioService} from "./StudioService"
import {connectRoom} from "./StudioLiveRoomConnect"

vi.mock("@opendaw/studio-core", () => ({YService: {getOrCreateRoom: vi.fn()}, SampleStorage: {}, SoundfontStorage: {}, Workers: {}}))
vi.mock("@opendaw/studio-p2p", () => ({P2PSession: class {trafficMeter = {}; terminate = vi.fn()}}))
vi.mock("./StudioLiveRoomDialog.tsx", () => ({showConnectRoomDialog: vi.fn(async roomName => ({roomName, userName: "Synthetic", userColor: "#123456"}))}))
vi.mock("./RoomAwareness", async original => ({...await original<object>(),
    RoomAwareness: class {panel = {setValue() {}}; terminate = vi.fn()}}))
const heartbeat = vi.hoisted(() => ({finalize: vi.fn(), pause: vi.fn(), resume: vi.fn()}))
vi.mock("./RoomStatsReporter", () => ({newRoomSessionId: () => "synthetic", reportRoomResult: vi.fn(), startRoomDurationHeartbeat: () => heartbeat}))
vi.mock("@/chat/ChatService", () => ({ChatService: class {terminate = vi.fn()}}))
vi.mock("@opendaw/lib-jsx", () => ({RouteLocation: {get: () => ({navigateTo() {}})}}))
vi.mock("@opendaw/lib-runtime", async original => ({...await original<object>(), Wait: {timeSpan: async () => {}}}))

const flush = async () => {for (let i = 0; i < 12; i++) {await Promise.resolve()}}
const makeProject = () => {
    const lifecycle = new Terminator()
    const destroy = vi.fn()
    lifecycle.own({terminate: destroy})
    return {own: (resource: Terminable) => lifecycle.own(resource), terminate: vi.fn(() => lifecycle.terminate()), destroy} as unknown as Project & {destroy: ReturnType<typeof vi.fn>}
}
const makeRoom = () => {
    const project = makeProject()
    const provider = {doc: {}, awareness: {getStates: () => new Map(), on() {}, off() {}}}
    return {project, provider} as unknown as YService.RoomResult
}
const makeService = () => {
    const current = makeProject()
    const profiles = new MutableObservableOption<{project: Project}>()
    profiles.wrap({project: current})
    const roomAwareness = new DefaultObservableValue<unknown>(null)
    const trafficMeter = new DefaultObservableValue<unknown>(null)
    const service = {
        projectProfileService: {
            getValue: () => profiles,
            subscribe: (observer: (profile: Option<{project: Project}>) => void) => profiles.subscribe(observer),
            setProject: vi.fn((project: Project) => {profiles.unwrap().project.terminate(); profiles.wrap({project})})
        },
        factoryFooterLabel: () => new MutableObservableOption(),
        roomAwareness, trafficMeter,
        setRoomAwareness: (value: unknown) => roomAwareness.setValue(value),
        setTrafficMeter: (value: unknown) => trafficMeter.setValue(value),
        chatService: new MutableObservableOption()
    } as unknown as StudioService
    return {service, profiles, current}
}
let progress: ReturnType<typeof vi.fn>
beforeEach(() => {
    heartbeat.finalize.mockClear(); heartbeat.pause.mockClear(); heartbeat.resume.mockClear()
    progress = vi.fn()
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({message: "", terminate: progress})
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
    vi.mocked(YService.getOrCreateRoom).mockReset()
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

describe("room connection intent", () => {
    it.each([false, true])("retires an older result when the newest attempt fails=%s", async fail => {
        const {service, current, profiles} = makeService()
        const a = Promise.withResolvers<YService.RoomResult>()
        const b = Promise.withResolvers<YService.RoomResult>()
        vi.mocked(YService.getOrCreateRoom).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
        const pa = connectRoom(service, "A")
        await flush()
        const pb = connectRoom(service, "B")
        await flush()
        const roomB = makeRoom()
        if (fail) {b.reject(new Error("synthetic failure"))} else {b.resolve(roomB)}
        await pb
        const roomA = makeRoom()
        a.resolve(roomA)
        await pa
        expect(profiles.unwrap().project).toBe(fail ? current : roomB.project)
        expect(service.projectProfileService.setProject).toHaveBeenCalledTimes(fail ? 0 : 1)
        expect(roomA.project.terminate).toHaveBeenCalledOnce()
        expect(current.destroy).toHaveBeenCalledTimes(fail ? 0 : 1)
        expect(progress).toHaveBeenCalledTimes(2)
        profiles.unwrap().project.terminate()
    })
    it.each(["replacement", "retirement"])("drops completion after project %s", async kind => {
        const {service, current, profiles} = makeService()
        const pending = Promise.withResolvers<YService.RoomResult>()
        vi.mocked(YService.getOrCreateRoom).mockReturnValue(pending.promise)
        const connecting = connectRoom(service, "A")
        await flush()
        if (kind === "replacement") {profiles.wrap({project: makeProject()})} else {current.terminate()}
        const room = makeRoom()
        pending.resolve(room)
        await connecting
        expect(service.projectProfileService.setProject).not.toHaveBeenCalled()
        expect(room.project.terminate).toHaveBeenCalledOnce()
        expect(progress).toHaveBeenCalledOnce()
    })
})

it("lets a replacement service's latest intent invalidate the old service", async () => {
    const old = makeService()
    const replacement = makeService()
    const a = Promise.withResolvers<YService.RoomResult>()
    const b = Promise.withResolvers<YService.RoomResult>()
    vi.mocked(YService.getOrCreateRoom).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const pa = connectRoom(old.service, "A")
    await flush()
    const pb = connectRoom(replacement.service, "B")
    await flush()
    const roomB = makeRoom()
    b.resolve(roomB)
    await pb
    const roomA = makeRoom()
    a.resolve(roomA)
    await pa
    expect(old.service.projectProfileService.setProject).not.toHaveBeenCalled()
    expect(replacement.profiles.unwrap().project).toBe(roomB.project)
    expect(roomA.project.terminate).toHaveBeenCalledOnce()
    replacement.profiles.unwrap().project.terminate()
    old.current.terminate()
})

it("suspends persisted pages and only resumes the still-owned room", async () => {
    const {service} = makeService(), room = makeRoom()
    vi.mocked(YService.getOrCreateRoom).mockResolvedValue(room)
    await connectRoom(service, "synthetic")
    window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: true}))
    expect(heartbeat.pause).toHaveBeenCalledOnce()
    expect(heartbeat.finalize).not.toHaveBeenCalled()
    window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}))
    expect(heartbeat.resume).toHaveBeenCalledOnce()
    window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: true}))
    room.project.terminate()
    window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}))
    expect(heartbeat.resume).toHaveBeenCalledOnce()
    expect(heartbeat.finalize).toHaveBeenCalledOnce()
})

it("terminal pagehide prevents subsequent resume", async () => {
    const {service} = makeService(), room = makeRoom()
    vi.mocked(YService.getOrCreateRoom).mockResolvedValue(room)
    await connectRoom(service, "synthetic")
    window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: false}))
    window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}))
    expect(heartbeat.finalize).toHaveBeenCalledOnce()
    expect(heartbeat.resume).not.toHaveBeenCalled()
    room.project.terminate()
})

it("joins a room when optional identity storage refuses writes", async () => {
    vi.stubGlobal("localStorage", {setItem: () => {throw new DOMException("Synthetic quota", "QuotaExceededError")}})
    const {service} = makeService(), room = makeRoom()
    vi.mocked(YService.getOrCreateRoom).mockResolvedValue(room)
    await connectRoom(service, "synthetic")
    expect(service.projectProfileService.setProject).toHaveBeenCalledWith(room.project, "synthetic")
    room.project.terminate()
})
