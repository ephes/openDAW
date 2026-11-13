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


describe("Router teardown", () => {
    it.each(["resolve", "reject"] as const)("disposes runtime owners before a late %s", async outcome => {
        const pending = deferred()
        const showingDisposed = vi.fn()
        const loadingDisposed = vi.fn()
        const preloaders = [vi.fn(), vi.fn()]
        const onshow = vi.fn()
        let count = 0
        const error = vi.fn(() => "error")
        const container = mount([
            {path: "/a", factory: ({lifecycle}) => {lifecycle.own({terminate: showingDisposed}); return "A"}},
            {path: "/b", factory: ({lifecycle}) => {lifecycle.own({terminate: loadingDisposed}); return pending.promise}}
        ], {onshow, error, preloader: () => ({terminate: preloaders[count++]})})
        await settle()
        RouteLocation.get().navigateTo("/b")
        runtime.terminate()
        runtime.terminate()
        expect(showingDisposed).toHaveBeenCalledTimes(1)
        expect(loadingDisposed).toHaveBeenCalledTimes(1)
        expect(preloaders[0]).toHaveBeenCalledTimes(1)
        expect(preloaders[1]).toHaveBeenCalledTimes(1)
        if (outcome === "resolve") {pending.resolve("B")} else {pending.reject("retired")}
        RouteLocation.get().navigateTo("/c")
        await settle()
        expect(container.textContent).toBe("A")
        expect(onshow).toHaveBeenCalledTimes(1)
        expect(error).not.toHaveBeenCalled()
        expect(loadingDisposed).toHaveBeenCalledTimes(1)
    })

    it("immediately clears resources owned by a never-settling cancelled factory", async () => {
        const disposed = vi.fn()
        const timer = setInterval(() => {}, 10000)
        const container = mount([
            {path: "/a", factory: () => "A"},
            {path: "/b", factory: ({lifecycle}) => {
                lifecycle.own({terminate: () => {clearInterval(timer); disposed()}})
                return new Promise(() => {})
            }}
        ])
        try {
            await settle()
            RouteLocation.get().navigateTo("/b")
            RouteLocation.get().navigateTo("/a")
            expect(disposed).toHaveBeenCalledTimes(1)
            expect(container.textContent).toBe("A")
            runtime.terminate()
            expect(disposed).toHaveBeenCalledTimes(1)
        } finally {clearInterval(timer)}
    })
})
