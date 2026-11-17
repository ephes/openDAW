import {beforeEach, describe, expect, it, vi} from "vitest"
import {Option} from "@opendaw/lib-std"
import {ErrorInfo} from "./ErrorInfo"

const mocks = vi.hoisted(() => ({stop: vi.fn(), info: vi.fn(async () => {}), error: vi.fn(), recover: vi.fn(() => Option.None)}))
vi.mock("@opendaw/lib-dom", () => ({AnimationFrame: {terminate: mocks.stop}, Browser: {}, Events: {}}))
vi.mock("@/ui/surface/Surface.tsx", () => ({Surface: {isAvailable: () => true}}))
vi.mock("@/ui/components/dialogs.tsx", () => ({Dialogs: {info: mocks.info, error: mocks.error}}))
import {ErrorHandler} from "./ErrorHandler"

const rejection = (reason: unknown) => new PromiseRejectionEvent("unhandledrejection", {reason, promise: Promise.resolve()})
const handler = () => new ErrorHandler({} as ConstructorParameters<typeof ErrorHandler>[0], mocks.recover)
beforeEach(() => {
    vi.clearAllMocks()
    document.head.innerHTML = "<script></script><script></script>"
    // jsdom does not implement these browser event classes.
    vi.stubGlobal("PromiseRejectionEvent", class extends Event {
        readonly reason: unknown
        constructor(type: string, init: PromiseRejectionEventInit) {super(type); this.reason = init.reason}
    })
    vi.stubGlobal("SecurityPolicyViolationEvent", class extends Event {})
})
describe("fatal error provenance", () => {
    it.each([1, 2])("keeps first-party errors fatal with %s scripts, once", scripts => {
        document.head.innerHTML = "<script></script>".repeat(scripts)
        const error = new Error("extension callback failed")
        error.stack = `Error: callback failed\n at ${window.location.origin}/studio.js:1:2\n at chrome-extension://abc/inject.js:1:2`
        const h = handler()
        expect(h.processError("test", new ErrorEvent("error", {error}))).toBe(true)
        expect(h.processError("test", new ErrorEvent("error", {error}))).toBe(false)
        expect(mocks.stop).toHaveBeenCalledOnce()
        expect(mocks.error).toHaveBeenCalledOnce()
        expect(mocks.recover).toHaveBeenCalledOnce()
    })
    it("uses first-party event filename when the stack is source-less", () => {
        const error = new Error("failed")
        error.stack = "callback@"
        expect(handler().processError("test", new ErrorEvent("error", {error, filename: `${window.location.origin}/studio.js`}))).toBe(true)
    })
    it("keeps extension-only and known ignored failures nonfatal", () => {
        const error = new Error("extension failure")
        error.stack = "at chrome-extension://abc/inject.js:1:2"
        expect(handler().processError("test", new ErrorEvent("error", {error}))).toBe(false)
        expect(handler().processError("test", new ErrorEvent("error", {message: "ResizeObserver loop completed with undelivered notifications."}))).toBe(false)
        expect(mocks.stop).not.toHaveBeenCalled()
    })
    it("keeps URL-less isolated-world stacks nonfatal without first-party evidence", () => {
        const error = new Error("cannot read property")
        error.stack = "keyHandler@\nonKeyDown@"
        expect(handler().processError("test", new ErrorEvent("error", {error}))).toBe(false)
        expect(mocks.stop).not.toHaveBeenCalled()
        expect(mocks.info).toHaveBeenCalledOnce()
    })
    it.each([1, 2])("makes one terminal decision for a source-less failure with %s scripts", scripts => {
        document.head.innerHTML = "<script></script>".repeat(scripts)
        expect(handler().processError("test", new Event("processorerror"))).toBe(true)
    })
})
describe("hostile diagnostics", () => {
    const throwing = () => {throw new Error("getter")}
    const hostile = [
        ...["message", "name", "code", "reason", "constructor", "stack", Symbol.toStringTag].map(key => Object.defineProperty({}, key, {get: throwing})),
        new Proxy({}, {get: throwing, getPrototypeOf: throwing, ownKeys: throwing}),
        Proxy.revocable({}, {}).proxy,
        Object.defineProperty(new Error("base"), "message", {get: throwing}),
        {message: {toString: throwing}, toJSON: throwing},
        {message: "x".repeat(10000)},
        undefined, null, 23, Symbol("reason"), 12n
    ]
    it.each(hostile)("extracts a bounded diagnostic and still reaches recovery (%#)", value => {
        const event = rejection(value)
        const info = ErrorInfo.extract(event)
        expect(typeof info.name).toBe("string")
        expect(info.name.length).toBeLessThanOrEqual(128)
        expect(info.message!.length).toBeLessThanOrEqual(2048)
        expect((info.stack ?? "").length).toBeLessThanOrEqual(8192)
        expect(handler().processError("test", event)).toBe(true)
        expect(mocks.stop).toHaveBeenCalledOnce()
        expect(mocks.error).toHaveBeenCalledOnce()
    })
    it("handles circular values, revoked proxies and throwing event.reason", () => {
        const circular: {reason?: unknown} = {}; circular.reason = circular
        const revoked = Proxy.revocable({}, {}); revoked.revoke()
        for (const event of [rejection(circular), rejection(revoked.proxy), Object.defineProperty(rejection(null), "reason", {get: throwing})]) {
            expect(() => ErrorInfo.extract(event)).not.toThrow()
            expect(handler().processError("test", event)).toBe(true)
        }
    })
    it("keeps the browser message when error fields are unavailable", () => {
        const event = new ErrorEvent("error", {error: {}, message: "browser diagnostic"})
        expect(ErrorInfo.extract(event).message).toBe("browser diagnostic")
    })
    it("preserves cross-realm error fields without enumerating or serializing objects", () => {
        const frame = document.createElement("iframe"); document.body.append(frame)
        const foreign = new (frame.contentWindow as Window & typeof globalThis).Error("foreign failure")
        expect(ErrorInfo.extract({type: "unhandledrejection", reason: foreign} as unknown as Event)).toMatchObject({name: "Error", message: "foreign failure"})
        frame.remove()
    })
})
