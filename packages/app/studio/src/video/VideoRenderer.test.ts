import {afterEach, beforeEach, expect, it, vi} from "vitest"
import type {Project} from "@opendaw/studio-core"
import {VideoRenderer} from "./VideoRenderer"

const m = vi.hoisted(() => ({
    dialog: vi.fn(), progress: vi.fn(), info: vi.fn(), dialogClose: vi.fn(), create: vi.fn(),
    add: vi.fn(), finalize: vi.fn(), abort: vi.fn(), exporterClose: vi.fn(),
    offline: vi.fn(), step: vi.fn(), play: vi.fn(), stop: vi.fn(), engineClose: vi.fn(),
    state: vi.fn(), stateClose: vi.fn(), runner: vi.fn(), runnerClose: vi.fn(), compile: vi.fn(),
    overlay: vi.fn(), overlayClose: vi.fn(), copy: vi.fn(), projectClose: vi.fn(), canvas: vi.fn()
}))
vi.mock("@opendaw/lib-std", async importOriginal => ({
    ...await importOriginal<object>(), RuntimeNotifier: {progress: m.progress, info: m.info}
}))
vi.mock("@opendaw/studio-core", () => ({OfflineEngineRenderer: {create: m.offline}}))
vi.mock("@opendaw/studio-boxes", () => ({ShadertoyBox: class {}}))
vi.mock("@/ui/shadertoy/ShadertoyState", () => ({ShadertoyState: class {
    constructor() {m.state()} setPPQN() {} terminate = m.stateClose
}}))
vi.mock("@/ui/shadertoy/ShadertoyRunner", () => ({ShadertoyRunner: class {
    constructor() {m.runner()} compile = m.compile; render() {} terminate = m.runnerClose
}}))
vi.mock("@/video", () => ({
    WebCodecsVideoExporter: {isSupported: () => true}, showVideoExportDialog: m.dialog,
    BufferVideoExporter: {create: m.create}, StreamVideoExporter: {create: m.create},
    VideoOverlay: {create: m.overlay}
}))
const config = {width: 1280, height: 720, frameRate: 30, duration: 1, overlay: false, videoBitrate: 8_000_000}
let total: number
let end: number
let tone: (seconds: number) => boolean
const project = {
    boxGraph: {beginTransaction() {}, endTransaction() {}},
    timelineBox: {loopArea: {enabled: {setValue() {}}}},
    rootBoxAdapter: {box: {shadertoy: {nonEmpty: () => false}}},
    timelineBoxAdapter: {signatureTrack: {toParts: () => ({bars: 0, beats: 0, semiquavers: 0, ticks: 0})}},
    tempoMap: {ppqnToSeconds: (value: number) => value, secondsToPPQN: (value: number) => value},
    lastRegionAction: () => end, liveStreamReceiver: {dispatch() {}}, terminate: m.projectClose
}
const source = {...project, copy: m.copy} as unknown as Project
const exporter = {addFrame: m.add, finalize: m.finalize, abort: m.abort, terminate: m.exporterClose}
const engine = {play: m.play, step: m.step, stop: m.stop, terminate: m.engineClose, get totalFrames() {return total}}
export const settle = async () => {for (let i = 0; i < 100; i++) {await Promise.resolve()}}
beforeEach(() => {
    vi.resetAllMocks()
    total = 0; end = 1; tone = () => true
    m.dialog.mockResolvedValue({...config})
    m.progress.mockReturnValue({terminate: m.dialogClose})
    m.create.mockResolvedValue(exporter)
    m.copy.mockReturnValue(project)
    m.offline.mockResolvedValue(engine)
    m.overlay.mockResolvedValue({render() {}, canvas: {}, terminate: m.overlayClose})
    m.step.mockImplementation(async (samples: number) => {
        if (m.step.mock.calls.length > 800) {throw new Error("unexpected render horizon")}
        const value = tone(total / 48000) ? 0.5 : 0
        total += samples
        return [new Float32Array(samples).fill(value), new Float32Array(samples).fill(-value)]
    })
    vi.stubGlobal("OffscreenCanvas", class {
        constructor(...args: unknown[]) {m.canvas(...args)}
        getContext() {return {drawImage() {}}}
    })
    Object.defineProperty(window, "showSaveFilePicker", {value: undefined, configurable: true})
})
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals()})
for (const invalid of [{width: 0}, {height: 1.5}, {duration: NaN}, {duration: -1}, {duration: Infinity}, {duration: 3601}]) {
    it(`refuses config ${JSON.stringify(invalid)} before file/canvas creation`, async () => {
        m.dialog.mockResolvedValue({...config, ...invalid})
        const picker = vi.fn()
        Object.defineProperty(window, "showSaveFilePicker", {value: picker, configurable: true})
        await expect(VideoRenderer.render(source, "Synthetic", 48000)).rejects.toThrow()
        expect(picker).not.toHaveBeenCalled()
        expect(m.canvas).not.toHaveBeenCalled()
        expect(m.create).not.toHaveBeenCalled()
    })
}
it("exports a deterministic one-second stereo fixture", async () => {
    await VideoRenderer.render(source, "Synthetic", 48000)
    expect(m.add).toHaveBeenCalledTimes(30)
    expect(m.finalize).toHaveBeenCalledTimes(1)
    expect(m.add.mock.calls[0][1][0][0]).toBe(0.5)
    expect(m.add.mock.calls[0][1][1][0]).toBe(-0.5)
    expect(total).toBe(48000)
})

it("preserves two tone regions separated by twelve seconds of silence", async () => {
    end = 14
    tone = seconds => seconds < 1 || (seconds >= 13 && seconds < 14)
    m.dialog.mockResolvedValue({...config, duration: 0})
    await VideoRenderer.render(source, "Synthetic gap", 48000)
    expect(m.add.mock.calls.some(call => call[2] >= 13 && call[1][0][0] !== 0)).toBe(true)
    expect(total / 48000).toBeGreaterThanOrEqual(24)
    expect(total / 48000).toBeLessThan(24.04)
})
it("finishes an empty silent project within the bounded tail", async () => {
    end = 0; tone = () => false
    m.dialog.mockResolvedValue({...config, duration: 0})
    await VideoRenderer.render(source, "Empty", 48000)
    expect(total / 48000).toBeLessThanOrEqual(10.04)
    expect(m.finalize).toHaveBeenCalledTimes(1)
})
it("caps a continuously sounding post-arrangement tail", async () => {
    end = 1
    m.dialog.mockResolvedValue({...config, duration: 0})
    await VideoRenderer.render(source, "Tail", 48000)
    expect(total / 48000).toBeLessThanOrEqual(11.04)
})
