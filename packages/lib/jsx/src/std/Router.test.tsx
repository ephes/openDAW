import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Terminator} from "@opendaw/lib-std"
import {RouteLocation, RouteMatcher} from "../routes"
import {PageFactory, Router, RouterConstruct} from "./Router"
import {JsxValue} from "../types"
import {LocalLink} from "./LocalLink"

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

describe("Router failure boundary", () => {
    it("keeps a published page alive when onshow throws", async () => {
        const disposed = vi.fn()
        const error = vi.fn(() => "error page")
        const onshow = vi.fn(() => {throw new Error("onshow failed")})
        const container = mount([{path: "/a", factory: ({lifecycle}) => {
            lifecycle.own({terminate: disposed})
            return "A"
        }}], {error, onshow})
        await settle()
        expect(container.textContent).toBe("A")
        expect(onshow).toHaveBeenCalledTimes(1)
        expect(disposed).not.toHaveBeenCalled()
        expect(error).not.toHaveBeenCalled()
        expect(console.warn).toHaveBeenCalledWith(expect.objectContaining({message: "onshow failed"}))
    })

    it("catches synchronous factory errors and disposes their subscriptions", async () => {
        const disposed = vi.fn()
        const error = vi.fn<PageFactory<null>>(() => "error page")
        const container = mount([{path: "/a", factory: ({lifecycle}) => {
            lifecycle.own({terminate: disposed})
            throw new Error("factory failed")
        }}], {error})
        await settle()
        expect(container.textContent).toBe("error page")
        expect(error).toHaveBeenCalledTimes(1)
        expect(error.mock.calls[0]?.[0]?.error).toContain("factory failed")
        expect(disposed).toHaveBeenCalledTimes(1)
    })

    it.each(["reject", "throw"] as const)("stops when the error factory fails by %s", async outcome => {
        const disposed = [vi.fn(), vi.fn()]
        const preloaders: Array<ReturnType<typeof vi.fn>> = []
        const onshow = vi.fn()
        let errorCalls = 0
        // Bound the broken implementation's recursion so the regression fails promptly.
        const error: PageFactory<null> = ({lifecycle}) => {
            errorCalls++
            if (errorCalls > 1) {return new Promise(() => {})}
            lifecycle.own({terminate: disposed[1]})
            if (outcome === "throw") {throw new Error("error page failed")}
            return Promise.reject(new Error("error page failed"))
        }
        const container = mount([
            {path: "/a", factory: () => "A"},
            {path: "/b", factory: ({lifecycle}) => {
                lifecycle.own({terminate: disposed[0]})
                return Promise.reject(new Error("primary failed"))
            }}
        ], {error, onshow, preloader: () => {
            const terminate = vi.fn()
            preloaders.push(terminate)
            return {terminate}
        }})
        await settle()
        RouteLocation.get().navigateTo("/b")
        await settle()
        expect(errorCalls).toBe(1)
        expect(container.textContent).toBe("A")
        expect(onshow).toHaveBeenCalledTimes(1)
        disposed.forEach(dispose => expect(dispose).toHaveBeenCalledTimes(1))
        preloaders.forEach(dispose => expect(dispose).toHaveBeenCalledTimes(1))
        RouteLocation.get().navigateTo("/c")
        await settle()
        expect(container.textContent).toBe("fallback")
    })

    it("retains the visible page when no error factory exists", async () => {
        const alert = vi.spyOn(window, "alert").mockImplementation(() => {})
        const disposed = vi.fn()
        const container = mount([
            {path: "/a", factory: () => "A"},
            {path: "/b", factory: ({lifecycle}) => {
                lifecycle.own({terminate: disposed})
                return Promise.reject("failed")
            }}
        ])
        await settle()
        RouteLocation.get().navigateTo("/b")
        await settle()
        expect(container.textContent).toBe("A")
        expect(disposed).toHaveBeenCalledTimes(1)
        expect(alert).toHaveBeenCalledTimes(1)
    })
})

describe("Route selection and initial navigation", () => {
    it.each([
        ["/", "root"], ["/a", "fallback"], ["/a/", "fallback"],
        ["/a/b", "long"], ["/a/b/", "long"], ["/a/b/c", "fallback"],
        ["/wild", "wild"], ["/wild/", "wild"], ["/wild/x/y", "wild"],
        ["/z", "short"], ["/z/", "short"], ["/missing", "fallback"]
    ])("selects %s through the Router", async (path, expected) => {
        history.replaceState(null, "", path)
        const container = mount([
            {path: "/z/b", factory: () => "too long"},
            {path: "/z", factory: () => "short"},
            {path: "/a/b", factory: () => "long"},
            {path: "/wild/*", factory: () => "wild"},
            {path: "/", factory: () => "root"}
        ])
        await settle()
        expect(container.textContent).toBe(expected)
    })

    it("observes synchronous redirects during the initial factory call", async () => {
        const disposed = vi.fn()
        const container = mount([
            {path: "/a", factory: ({lifecycle}) => {
                lifecycle.own({terminate: disposed})
                RouteLocation.get().navigateTo("/b")
                return "A"
            }},
            {path: "/b", factory: () => "B"}
        ])
        await settle()
        expect(location.pathname).toBe("/b")
        expect(container.textContent).toBe("B")
        expect(disposed).toHaveBeenCalledTimes(1)
    })

    it.each([
        ["/manuals", "/manuals/", true], ["/manuals/x/y", "/manuals/", true], ["/manuals/x", "/manuals", true],
        ["/manual", "/manuals/", false], ["/", "/", true], ["/manuals", "/", false], ["/a", "/a/b", false]
    ])("LocalLink treats %s as within %s: %s", (path, base, expected) => {
        expect(RouteMatcher.isWithin(path, base)).toBe(expected)
    })

    it("LocalLink stays active on deeper pages of its section", () => {
        history.replaceState(null, "", "/manuals/")
        const link = LocalLink({href: "/manuals/"}) as HTMLAnchorElement
        document.body.append(link)
        expect(link.classList.contains("active")).toBe(true)
        RouteLocation.get().navigateTo("/manuals/x")
        expect(link.classList.contains("active")).toBe(true)
        RouteLocation.get().navigateTo("/other")
        expect(link.classList.contains("active")).toBe(false)
    })

    it("unsubscribes when initial location delivery throws", () => {
        const observer = vi.fn(() => {throw new Error("initial delivery")})
        expect(() => RouteLocation.get().catchupAndSubscribe(observer)).toThrow("initial delivery")
        expect(() => RouteLocation.get().navigateTo("/b")).not.toThrow()
        expect(observer).toHaveBeenCalledTimes(1)
    })
})
