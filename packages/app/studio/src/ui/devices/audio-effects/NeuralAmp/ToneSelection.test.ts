import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox, NeuralAmpDeviceBox} from "@opendaw/studio-boxes"
import {NeuralAmpDeviceBoxAdapter, ProjectSkeleton} from "@opendaw/studio-adapters"
import {NamTone3000} from "./NamTone3000"

vi.mock("@opendaw/studio-core", () => ({Workers: {Opfs: {}}}))
vi.mock("./Tone3000Dialog", () => ({showTone3000Dialog: async () => {}}))
beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal("localStorage", {setItem: vi.fn(), removeItem: vi.fn()})})
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
const fixture = () => {
    const {boxGraph, mandatoryBoxes} = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const editing = new BoxEditing(boxGraph)
    const box = editing.modify(() => {
        const unit = AudioUnitBox.create(boxGraph, UUID.generate(), box => box.collection.refer(mandatoryBoxes.rootBox.audioUnits))
        return NeuralAmpDeviceBox.create(boxGraph, UUID.generate(), box => box.host.refer(unit.audioEffects))
    }).unwrap()
    const controller = new AbortController()
    return {controller, remove: () => editing.modify(() => box.delete()),
        run: NamTone3000.browse(boxGraph, editing, {box} as NeuralAmpDeviceBoxAdapter, controller.signal)}
}
const tick = async () => {await vi.advanceTimersByTimeAsync(0)}
it.each(["blocked", "timeout", "editor", "device"])("settles %s and releases listeners/timers", async kind => {
    const popup = {closed: false, close: vi.fn()}
    vi.spyOn(window, "open").mockReturnValue(kind === "blocked" ? null : popup as unknown as Window)
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener")
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    const f = fixture()
    let done = false
    const pending = f.run().then(() => {done = true})
    await tick()
    if (kind === "timeout") {await vi.advanceTimersByTimeAsync(5 * 60_000)}
    if (kind === "editor") {f.controller.abort(); await tick()}
    if (kind === "device") {f.remove(); await tick()}
    expect(done).toBe(true)
    await pending
    const listeners = add.mock.calls.filter(([name]) => name === "storage")
    expect(listeners.every(([name, fn]) => remove.mock.calls.some(([n, f]) => n === name && f === fn))).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(Object.assign(new Event("storage"), {key: "tone3000_tone_url", newValue: "https://example.test/stale"}))
    expect(fetch).not.toHaveBeenCalled()
})
it("binds concurrent callbacks to one selection and acknowledges only its window", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => ({closed: false, close: vi.fn()}) as unknown as Window)
    const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify({id: 1, title: "Synthetic", updated_at: "v1", models: []})))
    vi.stubGlobal("fetch", fetch)
    const f1 = fixture(), f2 = fixture()
    let done1 = false, done2 = false
    const p1 = f1.run().then(() => {done1 = true}), p2 = f2.run().then(() => {done2 = true})
    await tick()
    const ids = open.mock.calls.map(([url]) => new URL(new URL(String(url)).searchParams.get("redirect_url")!).searchParams.get("selection"))
    expect(ids[0]).toBeTruthy(); expect(ids[1]).not.toBe(ids[0])
    const send = (id: string | null, value: string) => window.dispatchEvent(Object.assign(new Event("storage"), {key: `tone3000_tone_url:${id}`, newValue: value, storageArea: localStorage}))
    send("foreign", "https://example.test/foreign"); send(ids[1], "https://example.test/second")
    await tick()
    expect(done1).toBe(false); expect(done2).toBe(true)
    send(ids[1], "https://example.test/duplicate"); send(ids[0], "https://example.test/first")
    await Promise.all([p1, p2])
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["https://example.test/second", "https://example.test/first"])
    expect(vi.getTimerCount()).toBe(0)
})
