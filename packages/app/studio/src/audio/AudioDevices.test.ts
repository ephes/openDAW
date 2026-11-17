import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {Dialogs} from "@/ui/components/dialogs"

vi.mock("@/ui/components/dialogs", () => ({Dialogs: {info: vi.fn(async () => true)}}))
beforeEach(() => {vi.resetModules(); vi.clearAllMocks()})
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})
const fixture = (permissions: unknown) => {
    const stop = vi.fn()
    const getUserMedia = vi.fn(async (_: MediaStreamConstraints) => ({getTracks: () => [{stop}]} as unknown as MediaStream))
    const enumerateDevices = vi.fn(async () => [{kind: "audioinput", deviceId: "synthetic", label: "Synthetic input"} as MediaDeviceInfo])
    vi.stubGlobal("navigator", {permissions, mediaDevices: {getUserMedia, enumerateDevices}})
    return {getUserMedia, enumerateDevices, stop}
}

it.each(["reject", "missing", "throw"])("captures when permission introspection is unsupported: %s", async kind => {
    const permissions = kind === "missing" ? undefined : {query: kind === "reject"
        ? vi.fn(async () => {throw new TypeError("unsupported permission name")})
        : vi.fn(() => {throw new TypeError("unsupported permission API")})}
    const f = fixture(permissions)
    const {AudioDevices} = await import("./AudioDevices")
    expect(await AudioDevices.queryListInputDevices()).toHaveLength(1)
    expect(f.getUserMedia).toHaveBeenCalledTimes(1)
    expect(f.stop).toHaveBeenCalledTimes(1)
    expect(Dialogs.info).not.toHaveBeenCalled()
})

it("keeps explicit denial visible without trying capture", async () => {
    const f = fixture({query: vi.fn(async () => ({name: "microphone", state: "denied"}))})
    const {AudioDevices} = await import("./AudioDevices")
    await expect(AudioDevices.queryListInputDevices()).rejects.toBe("Permission denied")
    expect(Dialogs.info).toHaveBeenCalledWith(expect.objectContaining({message: expect.stringContaining("denied")}))
    expect(f.getUserMedia).not.toHaveBeenCalled()
})

it("shares temporary permission capture and retries after capture refusal", async () => {
    const f = fixture({query: vi.fn(async () => {throw new TypeError("unsupported")})})
    f.getUserMedia.mockRejectedValueOnce(new DOMException("synthetic refusal", "NotAllowedError"))
    const {AudioDevices} = await import("./AudioDevices")
    await expect(AudioDevices.queryListInputDevices()).rejects.toBe("Permission to getUserMedia denied")
    const [a, b] = await Promise.all([AudioDevices.queryListInputDevices(), AudioDevices.queryListInputDevices()])
    expect(a).toHaveLength(1); expect(b).toHaveLength(1)
    expect(f.getUserMedia).toHaveBeenCalledTimes(2)
    expect(f.stop).toHaveBeenCalledTimes(1)
})

it("refuses a disappeared selected microphone instead of acquiring the browser fallback", async () => {
    const f = fixture({query: vi.fn(async () => ({name: "microphone", state: "granted"}))})
    const missing = new DOMException("synthetic input removed", "OverconstrainedError")
    const fallback = {getTracks: () => []} as unknown as MediaStream
    f.getUserMedia.mockImplementation(async constraints => {
        const audio = constraints.audio as MediaTrackConstraints
        if (typeof audio.deviceId === "object" && !Array.isArray(audio.deviceId) && audio.deviceId.exact === "removed") {throw missing}
        return fallback
    })
    const {AudioDevices} = await import("./AudioDevices")
    await expect(AudioDevices.queryAudioInputDeviceStream(48000, "removed", 1)).rejects.toBe(missing)
    expect(f.getUserMedia).toHaveBeenLastCalledWith({audio: expect.objectContaining({
        deviceId: {exact: "removed"}, channelCount: 1, sampleRate: 48000
    })})
    expect(await AudioDevices.queryAudioInputDeviceStream(48000)).toBe(fallback)
    expect((f.getUserMedia.mock.calls.at(-1)![0].audio as MediaTrackConstraints).deviceId).toBeUndefined()
})
