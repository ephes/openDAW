import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import * as Y from "yjs"
import {Option, RuntimeNotifier, Terminable, Terminator} from "@opendaw/lib-std"
import {Project, ProjectEnv, ProjectMigration} from "../project"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {YSync} from "./YSync"
import {YService} from "./YService"

const state = vi.hoisted(() => ({synced: true, existing: false, providers: [] as Array<{
    doc: Y.Doc, destroy: ReturnType<typeof vi.fn>, off: ReturnType<typeof vi.fn>, listeners: Map<string, unknown>
}>}))
vi.mock("y-websocket", () => ({WebsocketProvider: class {
    synced = state.synced
    listeners = new Map()
    destroy = vi.fn()
    on = vi.fn((event, listener) => this.listeners.set(event, listener))
    off = vi.fn((event) => this.listeners.delete(event))
    constructor(_url: string, _room: string, readonly doc: Y.Doc) {
        if (state.existing) {doc.getMap("boxes").set("synthetic", true)}
        vi.spyOn(doc, "destroy")
        state.providers.push(this)
    }
}}))
vi.mock("../project", () => ({Project: {new: vi.fn(), fromSkeleton: vi.fn()}, ProjectMigration: {migrate: vi.fn()}}))
vi.mock("@opendaw/studio-adapters", () => ({ProjectSkeleton: {findMandatoryBoxes: vi.fn(() => ({rootBox: {users: {}}}))}}))
vi.mock("@opendaw/studio-boxes", () => ({BoxIO: {create: vi.fn()}, UserInterfaceBox: {create: vi.fn(() => ({}))}}))

const env = {} as ProjectEnv
let project: Project
let sync: {terminate: ReturnType<typeof vi.fn>}
beforeEach(() => {
    state.synced = true
    state.existing = false
    state.providers = []
    const lifecycle = new Terminator()
    project = {boxGraph: {}, own: (resource: Terminable) => lifecycle.own(resource), terminate: vi.fn(() => lifecycle.terminate()),
        invalid: () => false, follow: vi.fn()} as unknown as Project
    sync = {terminate: vi.fn()}
    vi.mocked(Project.new).mockReturnValue(project)
    vi.mocked(Project.fromSkeleton).mockReturnValue(project)
    vi.mocked(ProjectMigration.migrate).mockResolvedValue()
    vi.spyOn(YSync, "populateRoom").mockResolvedValue(sync as unknown as YSync<unknown>)
    vi.spyOn(YSync, "joinRoom").mockImplementation(async ({boxGraph}) => {
        Object.assign(project, {boxGraph})
        return sync as unknown as YSync<unknown>
    })
})
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers()})
const released = () => {
    const provider = state.providers[0]
    expect(provider.destroy).toHaveBeenCalledOnce()
    expect(provider.doc.destroy).toHaveBeenCalledOnce()
    expect(provider.listeners.size).toBe(0)
}

describe("room construction unwind", () => {
    it("removes a pending listener and closes transport/document on timeout", async () => {
        vi.useFakeTimers()
        state.synced = false
        const pending = YService.getOrCreateRoom(Option.None, env, "timeout")
        const rejected = expect(pending).rejects.toThrow("Timeout")
        await vi.advanceTimersByTimeAsync(10_001)
        await rejected
        released()
        state.synced = true
        await expect(YService.getOrCreateRoom(Option.None, env, "retry")).resolves.toHaveProperty("project", project)
    })
    it("releases a declined room", async () => {
        state.existing = true
        vi.spyOn(RuntimeNotifier, "approve").mockResolvedValue(false)
        await expect(YService.getOrCreateRoom(Option.wrap(project), env, "decline")).rejects.toBeDefined()
        released()
        expect(project.terminate).not.toHaveBeenCalled()
    })
    it.each(["skeleton", "migration", "project", "follow"])("unwinds %s admission failure", async stage => {
        state.existing = true
        const error = new Error(stage)
        if (stage === "skeleton") {vi.mocked(ProjectSkeleton.findMandatoryBoxes).mockImplementationOnce(() => {throw error})}
        if (stage === "migration") {vi.mocked(ProjectMigration.migrate).mockRejectedValueOnce(error)}
        if (stage === "project") {vi.mocked(Project.fromSkeleton).mockImplementationOnce(() => {throw error})}
        if (stage === "follow") {vi.mocked(project.follow).mockImplementationOnce(() => {throw error})}
        await expect(YService.getOrCreateRoom(Option.None, env, "failed")).rejects.toBe(error)
        released()
        expect(sync.terminate).toHaveBeenCalledOnce()
        expect(project.terminate).toHaveBeenCalledTimes(stage === "follow" ? 1 : 0)
    })
    it("retires an unpublished new project when population fails", async () => {
        vi.mocked(YSync.populateRoom).mockRejectedValueOnce(new Error("populate"))
        await expect(YService.getOrCreateRoom(Option.None, env, "new")).rejects.toThrow("populate")
        released()
        expect(project.terminate).toHaveBeenCalledOnce()
    })
})

describe("room project lifetime", () => {
    it("closes the provider, document and sync exactly once on leave", async () => {
        const room = await YService.getOrCreateRoom(Option.None, env, "lifetime")
        expect(state.providers[0].destroy).not.toHaveBeenCalled()
        room.project.terminate()
        room.project.terminate()
        released()
        expect(sync.terminate).toHaveBeenCalledOnce()
        const next = await YService.getOrCreateRoom(Option.None, env, "next")
        expect(state.providers[1].destroy).not.toHaveBeenCalled()
        next.project.terminate()
        expect(state.providers[1].destroy).toHaveBeenCalledOnce()
    })
})
