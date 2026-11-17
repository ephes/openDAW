import {afterEach, expect, it, vi} from "vitest"
import {RuntimeNotifier} from "@opendaw/lib-std"
import {OpenSampleAPI} from "./OpenSampleAPI"
import {SampleUploadRefused} from "./SampleAPI"
const meta = {name: "Synthetic", bpm: 0, duration: 1, sample_rate: 48000, origin: "openDAW" as const}
class XHR {
    upload = new EventTarget()
    onreadystatechange: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    ontimeout: (() => void) | null = null
    readyState = 0
    status = 0
    responseText = "Synthetic response"
    open = vi.fn()
    setRequestHeader = vi.fn()
    send = vi.fn()
    abort = vi.fn(() => {this.readyState = 4; this.status = 0; this.onreadystatechange?.(); this.onabort?.()})
    complete(status: number): void {this.status = status; this.readyState = 4; this.onreadystatechange?.()}
}
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, "", "/")})
const setup = () => {
    const xhr = new XHR(), close = vi.fn()
    vi.stubGlobal("XMLHttpRequest", class {constructor() {return xhr}})
    vi.spyOn(RuntimeNotifier, "progress").mockReturnValue({message: "", terminate: close})
    vi.spyOn(RuntimeNotifier, "info").mockResolvedValue()
    history.replaceState(null, "", "/?access-key=synthetic")
    return {xhr, close}
}
it("holds the upload promise until remote completion", async () => {
    const {xhr, close} = setup()
    let done = false
    const result = OpenSampleAPI.get().upload(new ArrayBuffer(4), meta).then(() => {done = true})
    await Promise.resolve()
    expect(done).toBe(false)
    xhr.complete(200); await result
    expect(done).toBe(true); expect(close).toHaveBeenCalledOnce()
})
it.each(["abort", "error", "http"])("settles %s without replay", async kind => {
    const {xhr, close} = setup(), controller = new AbortController()
    const result = OpenSampleAPI.get().upload(new ArrayBuffer(4), meta, controller.signal)
    const rejection = kind === "abort"
        ? expect(result).rejects.toMatchObject({name: "AbortError"}) : expect(result).rejects.toThrow()
    if (kind === "abort") {controller.abort()} else if (kind === "error") {xhr.onerror?.()} else {xhr.complete(500)}
    await rejection
    expect(xhr.send).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
})

it("reports definite HTTP refusals with the server reason", async () => {
    const {xhr} = setup()
    const result = OpenSampleAPI.get().upload(new ArrayBuffer(4), meta)
    const rejection = expect(result).rejects.toThrow(new SampleUploadRefused("Synthetic duplicate"))
    xhr.responseText = JSON.stringify({message: "Synthetic duplicate"}); xhr.complete(409)
    await rejection
})
it("keeps server failures uncertain and refuses a missing access key before sending", async () => {
    const {xhr} = setup()
    const result = OpenSampleAPI.get().upload(new ArrayBuffer(4), meta)
    const rejection = expect(result).rejects.not.toBeInstanceOf(SampleUploadRefused)
    xhr.complete(503); await rejection
    history.replaceState(null, "", "/")
    await expect(OpenSampleAPI.get().upload(new ArrayBuffer(4), meta)).rejects.toBeInstanceOf(SampleUploadRefused)
    expect(xhr.send).toHaveBeenCalledOnce()
})
