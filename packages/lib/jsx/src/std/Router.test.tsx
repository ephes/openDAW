import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {RouteLocation} from "../routes"
import {PageFactory, Router, RouterConstruct} from "./Router"
import {JsxValue} from "../types"

const deferred = () => {
    let resolve!: (value: JsxValue) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<JsxValue>((yes, no) => {resolve = yes; reject = no})
    return {promise, resolve, reject}
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
let runtime: Terminator
const mount = (routes: Array<{path: string, factory: PageFactory<null>}>,
               options: Partial<RouterConstruct<null>> = {}) => {
    const container = Router({runtime, service: null, routes, fallback: () => "fallback", ...options})
    document.body.append(container)
    return container
}

beforeEach(() => {
    history.replaceState(null, "", "/a")
    runtime = new Terminator()
    vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
    runtime.terminate()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe("Router request ownership", () => {
    it("ignores a retired rejection after a newer page shows", async () => {
        const pending = deferred()
        const disposed = vi.fn()
        const error = vi.fn(() => "error")
        const container = mount([
            {path: "/a", factory: () => pending.promise},
            {path: "/b", factory: ({lifecycle}) => {lifecycle.own({terminate: disposed}); return "B"}}
        ], {error})
        RouteLocation.get().navigateTo("/b")
        await settle()
        pending.reject(new Error("retired"))
        await settle()
        expect(container.textContent).toBe("B")
        expect(error).not.toHaveBeenCalled()
        expect(disposed).not.toHaveBeenCalled()
    })

    it("cancels a pending page when returning to the visible path", async () => {
        const pending = deferred()
        const disposed = vi.fn()
        const visibleDisposed = vi.fn()
        const container = mount([
            {path: "/a", factory: ({lifecycle}) => {lifecycle.own({terminate: visibleDisposed}); return "A"}},
            {path: "/b", factory: ({lifecycle}) => {lifecycle.own({terminate: disposed}); return pending.promise}}
        ])
        await settle()
        RouteLocation.get().navigateTo("/b")
        RouteLocation.get().navigateTo("/a")
        pending.resolve("B")
        await settle()
        expect(container.textContent).toBe("A")
        expect(disposed).toHaveBeenCalledTimes(1)
        expect(visibleDisposed).not.toHaveBeenCalled()
    })
})
