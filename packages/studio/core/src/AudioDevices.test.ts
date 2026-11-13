import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

beforeEach(() => vi.resetModules())
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})
const device = (id: string, kind = "audioinput") => ({deviceId: id, kind, groupId: "synthetic-group", label: "synthetic"}) as MediaDeviceInfo
const fixture = async () => {
    const stop = [vi.fn(), vi.fn()]
    const stream = {getTracks: () => stop.map(stop => ({stop}))} as unknown as MediaStream
    const enumerateDevices = vi.fn<() => Promise<MediaDeviceInfo[]>>().mockResolvedValue([device("default")])
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal("navigator", {mediaDevices: {enumerateDevices, getUserMedia}})
    const {AudioDevices} = await import("./AudioDevices")
    return {AudioDevices, stop, stream, enumerateDevices, getUserMedia}
}

describe("microphone acquisition ownership", () => {
    it("stops every attempt-owned track exactly once if enumeration refuses setup", async () => {
        const f = await fixture()
        f.enumerateDevices.mockRejectedValue(new Error("private device detail"))
        await expect(f.AudioDevices.requestStream({})).rejects.toThrow("Could not enumerate devices.")
        f.stop.forEach(stop => expect(stop).toHaveBeenCalledTimes(1))
    })
    it("transfers a successful stream without stopping it", async () => {
        const f = await fixture()
        expect(await f.AudioDevices.requestStream({})).toBe(f.stream)
        f.stop.forEach(stop => expect(stop).not.toHaveBeenCalled())
        expect(f.AudioDevices.defaultInput?.deviceId).toBe("default")
    })
    it("keeps permission failure diagnostics free of browser details", async () => {
        const f = await fixture()
        f.getUserMedia.mockRejectedValue(new DOMException("synthetic private detail", "NotAllowedError"))
        await expect(f.AudioDevices.requestStream({})).rejects.toThrow(/^Audio input permission denied$/)
        expect(f.enumerateDevices).not.toHaveBeenCalled()
    })
})

describe("device inventory generations", () => {
    it("publishes only the newest complete generation, retaining the list while pending and after failure", async () => {
        const f = await fixture()
        await f.AudioDevices.updateInputList()
        const older = Promise.withResolvers<MediaDeviceInfo[]>()
        const newer = Promise.withResolvers<MediaDeviceInfo[]>()
        f.enumerateDevices.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
        const a = f.AudioDevices.updateInputList()
        const b = f.AudioDevices.updateInputList()
        expect(f.AudioDevices.defaultInput?.deviceId).toBe("default")
        newer.resolve([device("new"), device("output", "audiooutput")])
        await b
        expect(f.AudioDevices.inputs.map(d => d.deviceId)).toEqual(["new"])
        older.resolve([device("old")])
        await a
        expect(f.AudioDevices.defaultInput?.deviceId).toBe("new")
        f.enumerateDevices.mockRejectedValue(new Error("private refresh details"))
        await expect(f.AudioDevices.updateInputList()).rejects.toThrow(/^Could not enumerate devices\.$/)
        expect(f.AudioDevices.defaultInput?.deviceId).toBe("new")
    })
    it("invalidates older success even when the current refresh fails", async () => {
        const f = await fixture()
        await f.AudioDevices.updateInputList()
        const older = Promise.withResolvers<MediaDeviceInfo[]>()
        f.enumerateDevices.mockReturnValueOnce(older.promise).mockRejectedValueOnce(new Error("synthetic"))
        const a = f.AudioDevices.updateInputList()
        await expect(f.AudioDevices.updateInputList()).rejects.toThrow()
        older.resolve([device("stale")])
        await a
        expect(f.AudioDevices.defaultInput?.deviceId).toBe("default")
    })
})
