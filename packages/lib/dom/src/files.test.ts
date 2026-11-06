import {afterEach, describe, expect, it, vi} from "vitest"
import {RuntimeNotifier} from "@opendaw/lib-std"
import {Files} from "./files"

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})

describe("Files.save writer ownership", () => {
    const setup = (stage?: string, abortFails = false) => {
        let locked = false
        const failure = new Error(`Synthetic ${stage} failure`)
        const state = {stage}
        const operation = (name: string) => vi.fn(async () => {
            if (state.stage === name) {throw failure}
            if (name === "close") {locked = false}
        })
        const writable = {
            truncate: operation("truncate"), write: operation("write"), close: operation("close"),
            abort: vi.fn(async () => {
                locked = false
                if (abortFails) {throw new Error("Synthetic abort failure")}
            })
        }
        const createWritable = vi.fn(async () => {
            if (locked) {throw new Error("Writer still locked")}
            locked = true
            return writable
        })
        vi.stubGlobal("window", {showSaveFilePicker: vi.fn(async () => ({name: "synthetic.wav", createWritable}))})
        const notify = vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
        return {writable, failure, state, createWritable, notify}
    }

    it.each(["truncate", "write", "close"])("aborts after %s failure and permits retry", async stage => {
        const {writable, failure, state, createWritable, notify} = setup(stage)
        await expect(Files.save(new ArrayBuffer(2))).rejects.toBe(failure)
        expect(writable.abort).toHaveBeenCalledOnce()
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({headline: "Could not save file"}))
        state.stage = undefined
        await expect(Files.save(new ArrayBuffer(2))).resolves.toBe("synthetic.wav")
        expect(createWritable).toHaveBeenCalledTimes(2)
        expect(writable.abort).toHaveBeenCalledOnce()
    })

    it("preserves the save error when abort also fails", async () => {
        const {writable, failure} = setup("write", true)
        await expect(Files.save(new ArrayBuffer(2))).rejects.toBe(failure)
        expect(writable.abort).toHaveBeenCalledOnce()
    })

    it("closes successful saves without aborting", async () => {
        const {writable, notify} = setup()
        const data = new ArrayBuffer(2)
        await expect(Files.save(data)).resolves.toBe("synthetic.wav")
        expect(writable.truncate).toHaveBeenCalledWith(0)
        expect(writable.write).toHaveBeenCalledWith(data)
        expect(writable.close).toHaveBeenCalledOnce()
        expect(writable.abort).not.toHaveBeenCalled()
        expect(notify).not.toHaveBeenCalled()
    })
})
