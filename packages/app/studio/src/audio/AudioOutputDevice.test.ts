import {afterEach, describe, expect, it, vi} from "vitest"
import {AudioOutputDevice} from "./AudioOutputDevice"
import {AudioDevices} from "./AudioDevices"

vi.mock("./AudioDevices", () => ({AudioDevices: {queryListOutputDevices: vi.fn()}}))

class Context extends EventTarget {
    sinkId = ""
    setSinkId = vi.fn(async (id: string) => {this.sinkId = id})
}
const device = (deviceId: string) => ({deviceId, label: deviceId} as MediaDeviceInfo)
const flush = async () => {for (let i = 0; i < 10; i++) {await Promise.resolve()}}

describe("output routing", () => {
    afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
    const setup = async () => {
        Object.defineProperty(Context.prototype, "sinkId", {value: "", configurable: true})
        Object.defineProperty(Context.prototype, "setSinkId", {value: () => {}, configurable: true})
        vi.stubGlobal("AudioContext", Context)
        const context = new Context()
        return {context, output: await AudioOutputDevice.create(context as unknown as AudioContext)}
    }
    it("restores default and propagates switch refusal", async () => {
        const {context, output} = await setup()
        await output.setOutput(device("custom"))
        await output.setOutput(device("default"))
        expect(context.setSinkId.mock.calls).toEqual([["custom"], [""]])
        context.setSinkId.mockRejectedValueOnce(new Error("refused"))
        await expect(output.setOutput(device("custom"))).rejects.toThrow("refused")
    })
    it.each([false, true])("ignores stale enumeration (failure=%s)", async fail => {
        const {context, output} = await setup()
        let resolveA!: (value: MediaDeviceInfo[]) => void
        let rejectA!: (reason: Error) => void
        vi.spyOn(AudioDevices, "queryListOutputDevices")
            .mockImplementationOnce(() => new Promise((resolve, reject) => {resolveA = resolve; rejectA = reject}))
            .mockResolvedValueOnce([device("B")])
        context.sinkId = "A"; context.dispatchEvent(new Event("sinkchange"))
        context.sinkId = "B"; context.dispatchEvent(new Event("sinkchange"))
        await flush()
        if (fail) {rejectA(new Error("late"))} else {resolveA([device("A")])}
        await flush()
        expect(output.value.getValue().unwrap().deviceId).toBe("B")
    })
})
