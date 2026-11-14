import {Lifecycle} from "@opendaw/lib-std"
import {Html} from "@opendaw/lib-dom"

export type HTMLSource = string | URL | Promise<Response>
export const HTML_MAX_BYTES = 1024 * 1024
export const HTML_TIMEOUT_MS = 15_000

export const HTML = ({src, className, lifecycle}: { src: HTMLSource, className?: string, lifecycle?: Lifecycle }) => {
    const placeholder = document.createElement("span")
    const controller = new AbortController()
    const {signal} = controller
    let retired = false
    let finished = false
    let connected = false
    const retire = () => {
        if (finished || retired) {return}
        retired = true
        controller.abort()
        observer.disconnect()
    }
    const observer = new MutationObserver(records => {
        if (placeholder.isConnected) {connected = true; return}
        if (connected || records.some(record => Array.from(record.removedNodes).some(node =>
            node === placeholder || node.contains(placeholder)))) {retire()}
    })
    observer.observe(document, {childList: true, subtree: true})
    lifecycle?.own({terminate: retire})
    const timer = setTimeout(() => controller.abort(new Error("HTML load deadline exceeded")), HTML_TIMEOUT_MS)
    const wait = <T,>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener("abort", abort, {once: true})
        promise.then(value => {
            signal.removeEventListener("abort", abort)
            resolve(value)
        }, reason => {
            signal.removeEventListener("abort", abort)
            reject(reason)
        })
        if (signal.aborted) {abort()}
    })
    const read = async (response: Response): Promise<string> => {
        if (!response.ok || Number(response.headers.get("Content-Length")) > HTML_MAX_BYTES) {
            void response.body?.cancel().catch(() => {})
            throw new Error("HTML response refused")
        }
        if (response.body === null) {return ""}
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const chunks: string[] = []
        let bytes = 0
        try {
            for (;;) {
                const {done, value} = await wait(reader.read())
                signal.throwIfAborted()
                if (done) {break}
                bytes += value.byteLength
                if (bytes > HTML_MAX_BYTES) {throw new Error("HTML byte limit exceeded")}
                chunks.push(decoder.decode(value, {stream: true}))
            }
            chunks.push(decoder.decode())
            return chunks.join("")
        } catch (reason) {
            void reader.cancel(reason).catch(() => {})
            throw reason
        } finally {
            reader.releaseLock()
        }
    }
    const run = async () => {
        try {
            // Let JSX attach the placeholder, including for a literal string source.
            await Promise.resolve()
            let markup: string
            if (typeof src === "string") {
                signal.throwIfAborted()
                markup = src
                if (new TextEncoder().encode(markup).byteLength > HTML_MAX_BYTES) {
                    throw new Error("HTML byte limit exceeded")
                }
            } else {
                const pending = src instanceof URL
                    ? signal.aborted ? Promise.reject(signal.reason)
                        : fetch(src.toString(), {credentials: "same-origin", signal}) : src
                const response = await wait(pending.then(response => {
                    if (signal.aborted) {
                        void response.body?.cancel(signal.reason).catch(() => {})
                        throw signal.reason
                    }
                    return response
                }))
                markup = await read(response)
            }
            signal.throwIfAborted()
            if (retired || placeholder.parentNode === null) {return}
            const fragment = Html.sanitizeMarkup(markup)
            if (className !== undefined) {
                const classes = className.split(/\s+/).filter(Boolean)
                for (const node of fragment.children) {node.classList.add(...classes)}
            }
            placeholder.replaceWith(fragment)
        } catch (reason) {
            if (!retired) {
                console.warn(reason)
                placeholder.textContent = "Could not load content."
            }
        } finally {
            finished = true
            clearTimeout(timer)
            observer.disconnect()
        }
    }
    void run()
    return placeholder
}
