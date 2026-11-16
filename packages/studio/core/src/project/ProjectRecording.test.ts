import {afterEach, expect, it, vi} from "vitest"
import {RuntimeNotifier, Terminable, UUID} from "@opendaw/lib-std"
import {Project} from "./Project"
import {ProjectEnv} from "./ProjectEnv"
import {Recording} from "../capture/Recording"
import {Capture} from "../capture/Capture"

vi.hoisted(() => {vi.stubGlobal("AudioWorkletNode", class {})})
afterEach(() => {vi.restoreAllMocks()})
it.each(["stop", "retirement"])("cancels pending preparation on real project %s", async action => {
    const project = Project.new({} as ProjectEnv, {noDefaultUser: true})
    vi.spyOn(project.engine, "assertWorklet").mockImplementation(() => {})
    const publish = vi.spyOn(project.engine, "prepareRecordingState").mockImplementation(() => {})
    vi.spyOn(project.engine, "stopRecording").mockImplementation(() => {})
    const prepared = Promise.withResolvers<Terminable>()
    const retire = vi.fn(), startRecording = vi.fn(() => Terminable.Empty)
    const capture = {prepareRecording: () => prepared.promise, clearRecordedRegions: vi.fn(), startRecording,
        audioUnitBox: {address: {uuid: UUID.generate()}}} as unknown as Capture
    vi.spyOn(project.captureDevices, "filterArmed").mockReturnValue([capture])
    const start = vi.spyOn(Recording, "start")
    const notice = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
    project.startRecording(false)
    const attempt = start.mock.results[0].value
    if (action === "stop") {project.stopRecording()} else {project.terminate()}
    prepared.resolve({terminate: retire})
    await attempt.catch(() => {})
    await Promise.resolve()
    expect(startRecording).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(retire).toHaveBeenCalledTimes(1)
    expect(notice).not.toHaveBeenCalled()
    expect(Recording.isRecording).toBe(false)
    const other = Project.new({} as ProjectEnv, {noDefaultUser: true})
    vi.spyOn(other.engine, "prepareRecordingState").mockImplementation(() => {})
    const retry = await Recording.start(other, false)
    retry.terminate()
    other.terminate()
    if (action === "stop") {project.terminate()}
})
it("reports failed project startup without an unhandled rejection", async () => {
    const project = Project.new({} as ProjectEnv, {noDefaultUser: true})
    vi.spyOn(project.engine, "assertWorklet").mockImplementation(() => {})
    vi.spyOn(Recording, "start").mockRejectedValueOnce(new Error("synthetic startup"))
    const notice = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
    project.startRecording(false)
    await vi.waitFor(() => expect(notice).toHaveBeenCalledTimes(1))
    project.terminate()
})

it("reports transport startup failure even when its cleanup cancels preparation", async () => {
    const project = Project.new({} as ProjectEnv, {noDefaultUser: true})
    vi.spyOn(project.engine, "assertWorklet").mockImplementation(() => {})
    vi.spyOn(project.engine, "prepareRecordingState").mockImplementation(() => {throw new Error("synthetic transport setup")})
    vi.spyOn(project.engine, "stopRecording").mockImplementation(() => project.cancelRecordingPreparation())
    const start = vi.spyOn(Recording, "start")
    const notice = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
    project.startRecording(false)
    await start.mock.results[0].value.catch(() => {})
    await vi.waitFor(() => expect(notice).toHaveBeenCalledTimes(1))
    expect(Recording.isRecording).toBe(false)
    project.terminate()
})
