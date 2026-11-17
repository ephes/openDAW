import {afterEach, expect, it, vi} from "vitest"
import {ByteArrayOutput} from "@opendaw/lib-std"
import {PrimitiveUpdate, ValueSerialization} from "@opendaw/lib-box"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {Project} from "../project/Project"
import {ProjectEnv} from "../project/ProjectEnv"
import {Commit, CommitType} from "./Commit"
import {SyncLogReader} from "./SyncLogReader"

vi.hoisted(() => {vi.stubGlobal("AudioWorkletNode", class {})})
const loaded: Project[] = []
afterEach(() => {loaded.splice(0).forEach(project => project.terminate()); vi.restoreAllMocks()})
const record = (output: ByteArrayOutput, type: CommitType, bytes: ArrayBufferLike) => {
    output.writeInt(type); output.writeInt(Commit.VERSION)
    output.writeBytes(new Int8Array(64))
    output.writeInt(bytes.byteLength); output.writeBytes(new Int8Array(bytes))
    output.writeDouble(0)
}
it("refuses trailing update payload before opening a replay transaction or editing the loaded graph", async () => {
    const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const duration = skeleton.mandatoryBoxes.timelineBox.durationInPulses
    const oldDuration = duration.getValue()
    const updates = ByteArrayOutput.create()
    updates.writeInt(1)
    new PrimitiveUpdate(duration.address, ValueSerialization.int32, oldDuration, 123).write(updates)
    updates.writeByte(99)
    const log = ByteArrayOutput.create()
    record(log, CommitType.Init, ProjectSkeleton.encode(skeleton.boxGraph))
    record(log, CommitType.Updates, updates.toArrayBuffer())
    const load = Project.load.bind(Project)
    const transactions: ReturnType<typeof vi.spyOn>[] = []
    vi.spyOn(Project, "load").mockImplementation((env, bytes) => {
        const project = load(env, bytes)
        loaded.push(project)
        transactions.push(vi.spyOn(project.boxGraph, "beginTransaction"))
        return project
    })
    const outcome = await SyncLogReader.unwrap({} as ProjectEnv, log.toArrayBuffer() as ArrayBuffer)
        .then(() => null, error => error)
    expect(outcome).toBeInstanceOf(Error)
    expect(transactions[0]).not.toHaveBeenCalled()
    expect(loaded[0].timelineBox.durationInPulses.getValue()).toBe(oldDuration)
    expect(loaded[0].boxGraph.inTransaction()).toBe(false)
})
