import {afterEach, describe, expect, it, vi} from "vitest"
import {Exec} from "@opendaw/lib-std"
import {Await} from "./Await"

const deferred = () => {
    let resolve!: (value: string) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<string>((yes, no) => {resolve = yes; reject = no})
    return {promise, resolve, reject}
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
afterEach(() => vi.restoreAllMocks())

describe("Await generation ownership", () => {
    it.each(["resolve", "reject"] as const)("ignores older attempts that %s after the newest", async outcome => {
        const attempts = [deferred(), deferred(), deferred()]
        let repeat!: Exec
        let index = 0
        const failure = vi.fn(() => "failure")
        const success = vi.fn(value => value)
        const contents = Await({
            factory: () => attempts[index++].promise,
            loading: () => "loading", success, failure,
            repeat: start => {repeat = start}
        })
        repeat()
        repeat()
        attempts[2].resolve("newest")
        await settle()
        attempts[1].resolve("middle")
        if (outcome === "resolve") {attempts[0].resolve("oldest")} else {attempts[0].reject("oldest failed")}
        await settle()
        expect(contents.textContent).toBe("newest")
        expect(success).toHaveBeenCalledTimes(1)
        expect(failure).not.toHaveBeenCalled()
    })

    it("does not let a superseded error retry start another attempt", async () => {
        const attempts = [deferred(), deferred(), deferred()]
        let repeat!: Exec
        let retry!: Exec
        let index = 0
        const factory = vi.fn(() => attempts[index++].promise)
        const contents = Await({
            factory, loading: () => "loading", success: value => value,
            failure: props => {retry = props.retry; return "failure"},
            repeat: start => {repeat = start}
        })
        attempts[0].reject("old failure")
        await settle()
        const oldRetry = retry
        repeat()
        attempts[1].resolve("new content")
        await settle()
        oldRetry()
        expect(factory).toHaveBeenCalledTimes(2)
        expect(contents.textContent).toBe("new content")
    })
})

describe("Await failure settlement", () => {
    it("renders synchronous factory errors and provides a usable retry", async () => {
        let retry!: Exec
        const factory = vi.fn<() => Promise<string>>()
            .mockImplementationOnce(() => {throw new Error("sync factory")})
            .mockResolvedValueOnce("recovered")
        const contents = Await({
            factory, loading: () => "loading", success: value => value,
            failure: props => {retry = props.retry; return String(props.reason)}
        })
        await settle()
        expect(contents.textContent).toContain("sync factory")
        retry()
        await settle()
        expect(contents.textContent).toBe("recovered")
    })

    it("routes a success renderer throw through failure once", async () => {
        const failure = vi.fn(({reason}) => String(reason))
        const contents = Await({
            factory: () => Promise.resolve("value"), loading: () => "loading",
            success: () => {throw new Error("success render")}, failure
        })
        await settle()
        expect(failure).toHaveBeenCalledTimes(1)
        expect(contents.textContent).toContain("success render")
    })

    it("settles a throwing failure renderer without recursion or an unhandled rejection", async () => {
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        let repeat!: Exec
        const failure = vi.fn(() => {throw new Error("failure render")})
        const factory = vi.fn<() => Promise<string>>()
            .mockRejectedValueOnce("load failed").mockResolvedValueOnce("recovered")
        const contents = Await({
            factory, loading: () => "loading", success: value => value, failure,
            repeat: start => {repeat = start}
        })
        await settle()
        expect(failure).toHaveBeenCalledTimes(1)
        expect(warning).toHaveBeenCalledTimes(1)
        expect(contents.textContent).toBe("Could not load content.")
        repeat()
        await settle()
        expect(contents.textContent).toBe("recovered")
    })
})
