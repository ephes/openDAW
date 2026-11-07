import {afterEach, beforeEach, expect, it, vi} from "vitest"
import {RuntimeNotifier} from "@opendaw/lib-std"
import {CloudAuthManager} from "./CloudAuthManager"

const mocks = vi.hoisted(() => ({create: vi.fn(), alive: vi.fn()}))
vi.mock("./DropboxHandler", () => ({DropboxHandler: class {
    constructor(token: string) {mocks.create(token)}
    alive = mocks.alive
}}))
vi.mock("./GoogleDriveHandler", () => ({GoogleDriveHandler: class {
    constructor(token: string) {mocks.create(token)}
    alive = mocks.alive
}}))
class Channel {
    static all: Channel[] = []
    onmessage: ((event: {data: unknown}) => unknown) | null = null
    close = vi.fn()
    constructor() {Channel.all.push(this)}
    send(data: unknown) {return this.onmessage?.({data})}
}
let popups: Array<{url: URL, closed: boolean, close: ReturnType<typeof vi.fn>}>
let cancel: () => void
let terminate: ReturnType<typeof vi.fn>
let manager: CloudAuthManager
const flush = async () => {for (let i = 0; i < 20; i++) {await Promise.resolve()}}
const callback = (index: number, data: object) => {
    const state = popups[index].url.searchParams.get("state")
    return {type: "auth-callback", state, service: state?.split(".")[0], ...data}
}
beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    Channel.all = []; popups = []
    vi.stubGlobal("BroadcastChannel", Channel)
    terminate = vi.fn()
    vi.spyOn(RuntimeNotifier, "progress").mockImplementation(options => {
        cancel = options.cancel!
        return {terminate} as unknown as ReturnType<typeof RuntimeNotifier.progress>
    })
    vi.spyOn(window, "open").mockImplementation(url => {
        const popup = {url: new URL(String(url)), closed: false, close: vi.fn()}
        popups.push(popup)
        return popup as unknown as Window
    })
    mocks.alive.mockResolvedValue(undefined)
    manager = CloudAuthManager.create({Dropbox: "fake", GoogleDrive: "fake"})
})
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
it("correlates concurrent providers and ignores missing state, wrong provider, replays and closes while handling", async () => {
    const first = manager.getHandler("GoogleDrive")
    // A separate manager represents a second studio tab.
    const other = CloudAuthManager.create({Dropbox: "fake", GoogleDrive: "fake"})
    const second = other.getHandler("GoogleDrive")
    await flush()
    expect(RuntimeNotifier.progress).toHaveBeenCalledWith(expect.objectContaining({headline: "Google Drive"}))
    expect(popups[0].url.searchParams.get("state")).not.toBe(popups[1].url.searchParams.get("state"))
    for (const data of [null, {type: "auth-callback", access_token: "bad"}, callback(0, {service: "dropbox", access_token: "bad"}), callback(1, {access_token: "other"})]) {
        await Channel.all[0].send(data)
    }
    expect(mocks.create).not.toHaveBeenCalled()
    const pending = Channel.all[0].send(callback(0, {access_token: "first"}))
    await Channel.all[0].send(callback(0, {access_token: "duplicate"}))
    await Channel.all[0].send(callback(0, {type: "closed"}))
    await pending; await first
    await Channel.all[1].send(callback(1, {access_token: "second"})); await second
    expect(mocks.create.mock.calls).toEqual([["first"], ["second"]])
    expect(vi.getTimerCount()).toBe(0)
    expect(Channel.all.every(channel => channel.close.mock.calls.length === 1)).toBe(true)
})
for (const mode of ["close", "cancel", "provider"] as const) {
    it(`settles and releases all resources on ${mode}`, async () => {
        const pending = manager.getHandler("GoogleDrive")
        const failure = expect(pending).rejects.toThrow(/Authentication/)
        await flush()
        if (mode === "close") {await Channel.all[0].send(callback(0, {type: "closed"}))}
        if (mode === "cancel") {cancel()}
        if (mode === "provider") {await Channel.all[0].send(callback(0, {type: "auth-error"}))}
        await failure
        expect(terminate).toHaveBeenCalledOnce()
        expect(popups[0].close).toHaveBeenCalledOnce()
        expect(Channel.all[0].onmessage).toBeNull()
        expect(vi.getTimerCount()).toBe(0)
    })
}
it("aborts a cancelled PKCE exchange and never creates a late handler", async () => {
    let finish!: (value: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => {finish = resolve}))
    vi.stubGlobal("fetch", fetchMock)
    const pending = manager.getHandler("Dropbox")
    const failure = expect(pending).rejects.toThrow("cancelled")
    await vi.waitFor(() => expect(popups).toHaveLength(1))
    const handling = Channel.all[0].send(callback(0, {code: "fake-code"}))
    cancel(); await failure
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    finish(Response.json({access_token: "late-token"})); await handling
    expect(mocks.create).not.toHaveBeenCalled()
})
it("never exposes credential or error-body sentinels in diagnostics", async () => {
    const output: unknown[] = []
    for (const method of ["debug", "warn", "error"] as const) {vi.spyOn(console, method).mockImplementation((...args) => {output.push(args)})}
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("BODY_SENTINEL", {status: 400})))
    const pending = manager.getHandler("Dropbox")
    const failure = pending.catch(error => {output.push(String(error))})
    await vi.waitFor(() => expect(popups).toHaveLength(1))
    await Channel.all[0].send(callback(0, {code: "CODE_SENTINEL"})); await failure
    mocks.create.mockImplementationOnce(() => {throw new Error("HANDLER_SENTINEL")})
    const google = manager.getHandler("GoogleDrive").catch(error => {output.push(String(error))})
    await flush()
    await Channel.all[1].send(callback(1, {access_token: "TOKEN_SENTINEL"})); await google
    expect(JSON.stringify(output)).not.toMatch(/SENTINEL/)
})

it("does not mistake a COOP-severed proxy for a closed provider popup", async () => {
    const pending = manager.getHandler("GoogleDrive")
    await flush()
    popups[0].closed = true
    await vi.advanceTimersByTimeAsync(1000)
    await Channel.all[0].send(callback(0, {access_token: "synthetic"}))
    await expect(pending).resolves.toBeDefined()
})

it("redacts alive failures and successful PKCE credentials", async () => {
    const output: unknown[] = []
    for (const method of ["debug", "warn", "error"] as const) {vi.spyOn(console, method).mockImplementation((...args) => {output.push(args)})}
    mocks.alive.mockRejectedValueOnce(new Error("ALIVE_SENTINEL"))
    const pending = manager.getHandler("GoogleDrive").catch(error => {output.push(String(error))})
    await flush()
    await Channel.all[0].send(callback(0, {access_token: "TOKEN_SENTINEL"})); await pending
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({access_token: "PKCE_SENTINEL"})))
    const dropbox = manager.getHandler("Dropbox")
    await vi.waitFor(() => expect(popups).toHaveLength(2))
    await Channel.all[1].send(callback(1, {code: "PKCE_CODE_SENTINEL"})); await dropbox
    expect(JSON.stringify(output)).not.toMatch(/SENTINEL/)
})
it("keeps concurrent Dropbox codes and Google tokens/close messages with their own attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({access_token: "dropbox-token"}))
    vi.stubGlobal("fetch", fetchMock)
    const google = manager.getHandler("GoogleDrive")
    const dropbox = manager.getHandler("Dropbox")
    await vi.waitFor(() => expect(popups).toHaveLength(2))
    expect(popups[1].url.searchParams.get("code_challenge_method")).toBe("S256")
    await Channel.all[0].send(callback(1, {code: "dropbox-code"}))
    await Channel.all[0].send(callback(1, {type: "closed"}))
    await Channel.all[1].send(callback(0, {access_token: "google-token"}))
    await Channel.all[1].send(callback(0, {type: "closed"}))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    const handling = Channel.all[1].send(callback(1, {code: "dropbox-code"}))
    await Channel.all[1].send(callback(1, {type: "closed"}))
    await Channel.all[0].send(callback(0, {access_token: "google-token"}))
    await handling; await Promise.all([google, dropbox])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.create.mock.calls.map(([token]) => token).sort()).toEqual(["dropbox-token", "google-token"])
})
