import {Errors} from "@opendaw/lib-std"

const SelectionTimeout = 5 * 60_000

/** One popup and one finite storage exchange, scoped to this invocation. */
export const selectToneUrl = (signal: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const id = crypto.randomUUID()
    const key = `tone3000_tone_url:${id}`
    const doneKey = `tone3000_done:${id}`
    const redirect = new URL("/tone3000-callback.html", window.location.origin)
    redirect.searchParams.set("selection", id)
    const url = new URL("https://www.tone3000.com/api/v1/select")
    url.search = new URLSearchParams({app_id: "openDAW", redirect_url: redirect.href, platform: "nam"}).toString()
    let popup: Window | null = null
    let settled = false
    const finish = (value?: string) => {
        if (settled) {return}
        settled = true
        clearTimeout(timeout)
        window.removeEventListener("storage", onStorage)
        signal.removeEventListener("abort", abort)
        try {
            if (value !== undefined) {localStorage.setItem(doneKey, "true")}
            localStorage.removeItem(key)
            localStorage.removeItem(doneKey)
        } catch { /* Storage refusal must still settle and release the popup. */ }
        try {popup?.close()} catch { /* A navigated popup may already be closed. */ }
        if (value === undefined) {reject(Errors.AbortError)} else {resolve(value)}
    }
    const abort = () => finish()
    const onStorage = (event: StorageEvent) => {
        if (event.storageArea === localStorage && event.key === key && event.newValue) {finish(event.newValue)}
    }
    const timeout = setTimeout(abort, SelectionTimeout)
    window.addEventListener("storage", onStorage)
    signal.addEventListener("abort", abort, {once: true})
    try {
        popup = window.open(url.href, `tone3000-${id}`)
        if (popup === null) {abort()}
    } catch {abort()}
})
