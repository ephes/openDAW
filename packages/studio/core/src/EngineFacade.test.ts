import {afterEach, expect, it, vi} from "vitest"
import {DefaultObservableValue, RuntimeNotifier} from "@opendaw/lib-std"
import {Preferences, PreferencesFacade, PreferencesHost} from "@opendaw/lib-fusion"
import {EngineSettingsSchema} from "@opendaw/studio-adapters"
import {EngineFacade} from "./EngineFacade"
import {EngineWorklet} from "./EngineWorklet"

vi.mock("./EngineWorklet", () => ({}))
afterEach(() => vi.restoreAllMocks())
const setup = () => {
    vi.spyOn(Preferences, "facade").mockImplementation((_key, schema) => new PreferencesFacade(schema.parse({})) as never)
    const facade = new EngineFacade()
    const deferred = Promise.withResolvers<void>()
    const worklet = () => ({
        context: {state: "suspended", resume: vi.fn(() => deferred.promise)},
        play: vi.fn(), stop: vi.fn(), terminate: vi.fn(),
        playbackTimestamp: new DefaultObservableValue(0), countInBeatsRemaining: new DefaultObservableValue(0),
        position: new DefaultObservableValue(0), bpm: new DefaultObservableValue(120),
        isPlaying: new DefaultObservableValue(false), isRecording: new DefaultObservableValue(false),
        isCountingIn: new DefaultObservableValue(false), markerState: new DefaultObservableValue(null), cpuLoad: new DefaultObservableValue(0),
        preferences: new PreferencesHost(EngineSettingsSchema.parse({}))
    })
    const first = worklet()
    facade.setWorklet(first as unknown as EngineWorklet)
    return {facade, deferred, first, worklet}
}
it.each(["stop", "release", "replace", "new play"])("binds resume to the current transport intent: %s", async action => {
    const {facade, deferred, first, worklet} = setup()
    facade.play()
    if (action === "stop") {facade.stop()}
    if (action === "release") {facade.releaseWorklet()}
    if (action === "replace") {facade.setWorklet(worklet() as unknown as EngineWorklet)}
    if (action === "new play") {facade.play()}
    deferred.resolve()
    await Promise.resolve()
    expect(first.play).toHaveBeenCalledTimes(action === "new play" ? 1 : 0)
    facade.terminate()
})
it("reports resume refusal once and allows a later valid play", async () => {
    const {facade, deferred, first} = setup()
    const notify = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
    facade.play()
    deferred.reject(new Error("synthetic resume refusal"))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(first.play).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    first.context.resume.mockResolvedValue(undefined)
    facade.play()
    await Promise.resolve()
    expect(first.play).toHaveBeenCalledTimes(1)
    facade.terminate()
})

it("handles a synchronous resume refusal through the playback error path", async () => {
    const {facade, first} = setup()
    const notify = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue(undefined)
    first.context.resume.mockImplementationOnce(() => {throw new Error("synthetic synchronous resume")})
    facade.play()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(first.play).not.toHaveBeenCalled()
    facade.terminate()
})
