import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {PlaybackEvent, SamplePlayback} from "./SamplePlayback"

const mocks = vi.hoisted(() => ({load: vi.fn(), encode: vi.fn(() => new ArrayBuffer(0))}))
vi.mock("@opendaw/studio-core", () => ({SampleStorage: {get: () => ({load: mocks.load})}, OpenSampleAPI: {FileRoot: "https://synthetic.invalid"}}))
vi.mock("@opendaw/lib-dsp", () => ({dbToGain: () => 1, WavFile: {encodeFloats: mocks.encode}}))
const a = "00000000-0000-4000-8000-000000000001"
const b = "00000000-0000-4000-8000-000000000002"
const audioData = [{frames: [], sampleRate: 44100, numberOfFrames: 0, numberOfChannels: 1}]
let audio: FakeAudio
let create: ReturnType<typeof vi.fn>
let revoke: ReturnType<typeof vi.fn>
class FakeAudio {
    src = ""
    paused = true
    duration = 1
    currentTime = 0
    onended: (() => void) | null = null
    ontimeupdate: (() => void) | null = null
    onpause: (() => void) | null = null
    onstalled: (() => void) | null = null
    play = vi.fn(async () => {this.paused = false; this.ontimeupdate?.()})
    pause() {this.paused = true; this.onpause?.()}
    removeAttribute() {this.src = ""}
    load() {}
    constructor() {
        // Expose the browser-created fake element to assertions.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        audio = this
    }
}
beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("Audio", FakeAudio)
    let serial = 0
    create = vi.fn(() => `blob:${++serial}`)
    revoke = vi.fn()
    vi.stubGlobal("URL", class extends URL {static createObjectURL = create; static revokeObjectURL = revoke})
    mocks.load.mockResolvedValue(audioData)
})
afterEach(() => {vi.unstubAllGlobals()})
const settle = async () => {for (let i = 0; i < 12; i++) {await Promise.resolve()}}
for (const reverse of [false, true]) {
    it(`keeps B selected when deferred loads resolve reverse=${reverse}`, async () => {
        let doneA!: (value: unknown) => void
        let doneB!: (value: unknown) => void
        mocks.load.mockImplementationOnce(() => new Promise(resolve => {doneA = resolve}))
            .mockImplementationOnce(() => new Promise(resolve => {doneB = resolve}))
        const playback = new SamplePlayback()
        playback.toggle(a); playback.toggle(b)
        if (reverse) {doneB(audioData); await settle(); doneA(audioData)}
        else {doneA(audioData); await settle(); doneB(audioData)}
        await settle()
        expect(create).toHaveBeenCalledTimes(1)
        expect(audio.play).toHaveBeenCalledTimes(1)
        expect(audio.src).toBe("blob:1")
        playback.eject()
        expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:1")
    })
}
it("never attaches or plays a pending load after eject", async () => {
    let done!: (value: unknown) => void
    mocks.load.mockImplementationOnce(() => new Promise(resolve => {done = resolve}))
    const playback = new SamplePlayback()
    playback.toggle(a); playback.eject(); done(audioData); await settle()
    expect(audio.src).toBe("")
    expect(audio.play).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
})
it("reports rejected play and supports explicit retry", async () => {
    const playback = new SamplePlayback()
    const events: PlaybackEvent[] = []
    playback.subscribe(a, event => events.push(event))
    audio.play.mockRejectedValueOnce(new DOMException("synthetic", "NotAllowedError"))
    playback.toggle(a); await settle()
    expect(events.at(-1)?.type).toBe("error")
    playback.toggle(a); await settle()
    expect(events.at(-1)?.type).toBe("playing")
})
it("ignores obsolete play rejection and revokes each replaced local URL once", async () => {
    let reject!: (error: unknown) => void
    const playback = new SamplePlayback()
    audio.play.mockImplementationOnce(() => new Promise((_, fail) => {reject = fail}))
    const events: PlaybackEvent[] = []
    playback.subscribe(b, event => events.push(event))
    playback.toggle(a); await settle()
    playback.toggle(b); await settle()
    reject(new DOMException("obsolete", "NotAllowedError")); await settle()
    expect(events.at(-1)?.type).toBe("playing")
    expect(revoke.mock.calls).toEqual([["blob:1"]])
    playback.eject(); playback.eject()
    expect(revoke.mock.calls).toEqual([["blob:1"], ["blob:2"]])
})
it("never revokes a remote fallback URL", async () => {
    mocks.load.mockRejectedValue(new Error("missing local"))
    const playback = new SamplePlayback()
    playback.toggle(a); await settle(); playback.eject()
    expect(create).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
})

it("retries preparation after a transient encoder failure", async () => {
    mocks.encode.mockImplementationOnce(() => {throw new Error("synthetic encoder")})
    const playback = new SamplePlayback()
    const events: PlaybackEvent[] = []
    playback.subscribe(a, event => events.push(event))
    playback.toggle(a); await settle()
    expect(events.at(-1)?.type).toBe("error")
    playback.toggle(a); await settle()
    expect(mocks.load).toHaveBeenCalledTimes(2)
    expect(audio.src).toBe("blob:1")
    expect(events.at(-1)?.type).toBe("playing")
})
