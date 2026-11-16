import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, Editing, Terminable, UUID} from "@opendaw/lib-std"
import {Recording} from "./Recording"
import {RecordAutomation} from "./RecordAutomation"
import {Project} from "../project/Project"

vi.mock("./RecordAutomation", () => ({RecordAutomation: {start: vi.fn(() => Terminable.Empty)}}))
afterEach(() => vi.restoreAllMocks())
const capture = () => {
    const release = vi.fn(), retire = vi.fn()
    return {audioUnitBox: {address: {uuid: UUID.generate()}}, clearRecordedRegions: vi.fn(),
        prepareRecording: vi.fn(async (): Promise<Terminable> => ({terminate: retire})), startRecording: vi.fn(() => ({terminate: release})), release, retire}
}
const setup = () => {
    const captures = [capture(), capture()]
    const engine = {preferences: {settings: {recording: {automationEnabled: false}}},
        isPlaying: new DefaultObservableValue(false), isRecording: new DefaultObservableValue(false),
        isCountingIn: new DefaultObservableValue(false), position: new DefaultObservableValue(0),
        prepareRecordingState: vi.fn(), stopRecording: vi.fn(), assertWorklet: vi.fn()}
    const project = {captureDevices: {filterArmed: () => captures}, engine, editing: Editing.Transient,
        regionSelection: {selected: () => [], deselect: vi.fn()}}
    return {captures, engine, project: project as unknown as Project}
}
it.each([false, true])("retires every preparation after aggregate failure (late success: %s)", async late => {
    const {captures, project, engine} = setup()
    const done = Promise.withResolvers<Terminable>()
    if (late) {captures[0].prepareRecording.mockReturnValueOnce(done.promise)}
    captures[1].prepareRecording.mockRejectedValueOnce(new Error("synthetic preparation"))
    const attempt = Recording.start(project, false)
    const observed = attempt.then(() => null, error => error)
    await Promise.resolve(); await Promise.resolve()
    if (late) {done.resolve({terminate: captures[0].retire})}
    expect(await observed).toBeInstanceOf(Error)
    expect(captures[0].retire).toHaveBeenCalledTimes(1)
    expect(captures[0].startRecording).not.toHaveBeenCalled()
    expect(engine.prepareRecordingState).not.toHaveBeenCalled()
    expect(Recording.isRecording).toBe(false)
    const retry = await Recording.start(project, false)
    retry.terminate()
    expect(captures[0].prepareRecording).toHaveBeenCalledTimes(2)
})
it.each(["second capture", "automation", "transport"])("unwinds startup resources when %s throws", async stage => {
    const {captures, project, engine} = setup()
    const fault = new Error(`synthetic ${stage}`)
    if (stage === "second capture") {captures[1].startRecording.mockImplementationOnce(() => {throw fault})}
    if (stage === "automation") {
        engine.preferences.settings.recording.automationEnabled = true
        vi.mocked(RecordAutomation.start).mockImplementationOnce(() => {throw fault})
    }
    if (stage === "transport") {engine.prepareRecordingState.mockImplementationOnce(() => {throw fault})}
    await expect(Recording.start(project, false)).rejects.toBe(fault)
    expect(captures[0].release).toHaveBeenCalledTimes(1)
    expect(captures[1].release).toHaveBeenCalledTimes(stage === "second capture" ? 0 : 1)
    expect(Recording.isRecording).toBe(false)
    const retry = await Recording.start(project, false)
    retry.terminate()
    expect(Recording.isRecording).toBe(false)
})
it("resets global ownership even when startup cleanup throws", async () => {
    const {captures, project} = setup()
    captures[0].release.mockImplementation(() => {throw new Error("synthetic cleanup")})
    captures[1].startRecording.mockImplementation(() => {throw new Error("synthetic startup")})
    await expect(Recording.start(project, false)).rejects.toThrow("synthetic startup")
    expect(Recording.isRecording).toBe(false)
})
