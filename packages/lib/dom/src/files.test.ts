// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest"
import {Files} from "./files"

afterEach(() => {vi.restoreAllMocks(); document.body.replaceChildren()})

it("cleans a fallback input and both listeners when click throws", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {throw new Error("click failed")})
    const remove = vi.spyOn(HTMLInputElement.prototype, "removeEventListener")
    await expect(Files.open()).rejects.toThrow("click failed")
    expect(document.querySelectorAll("input")).toHaveLength(0)
    expect(remove.mock.calls.map(call => call[0]).sort()).toEqual(["cancel", "change"])
})

it("rejects file-list extraction errors, ignores reentry and allows a fresh picker", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
    const remove = vi.spyOn(HTMLInputElement.prototype, "removeEventListener")
    const pending = Files.open()
    const input = document.querySelector("input")!
    const item = vi.fn(() => {throw new Error("item failed")})
    Object.defineProperty(input, "files", {value: {length: 1, item}})
    input.dispatchEvent(new Event("change"))
    await expect(pending).rejects.toThrow("item failed")
    input.dispatchEvent(new Event("cancel")); input.dispatchEvent(new Event("change"))
    expect(item).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(document.querySelectorAll("input")).toHaveLength(0)
    const next = Files.open()
    const fresh = document.querySelector("input")!
    const file = new File(["synthetic"], "test.mid")
    Object.defineProperty(fresh, "files", {value: {length: 1, item: () => file}})
    fresh.dispatchEvent(new Event("change"))
    await expect(next).resolves.toEqual([file])
    expect(document.querySelectorAll("input")).toHaveLength(0)
})

it("cleans before cancellation settles and ignores subsequent change", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
    const pending = Files.open()
    const input = document.querySelector("input")!
    input.dispatchEvent(new Event("cancel"))
    expect(input.isConnected).toBe(false)
    input.dispatchEvent(new Event("change"))
    await expect(pending).rejects.toMatchObject({name: "AbortError"})
})

it("cleans even when append attaches the node and then throws", async () => {
    const append = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, "appendChild").mockImplementation(node => {append(node); throw new Error("append failed")})
    await expect(Files.open()).rejects.toThrow("append failed")
    expect(document.querySelectorAll("input")).toHaveLength(0)
})
