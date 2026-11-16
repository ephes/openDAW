import {Promises} from "./promises"
import {
    Errors,
    identity,
    int,
    isAbsent,
    isDefined,
    isInstanceOf,
    Progress,
    RuntimeNotifier
} from "@opendaw/lib-std"

export namespace network {
    const limit = new Promises.Limit<Response>(4)

    export const limitFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        limit.add(() => fetch(input, init))

    // This policy is for idempotent reads/imports, never automatic mutation replay.
    export const defaultRetry = (reason: unknown, count: int): boolean => {
        if (!Number.isInteger(count) || count < 1 || count >= 3 || Errors.isAbort(reason) ||
            isInstanceOf(reason, Errors.FileNotFound)) {return false}
        if (typeof reason === "object" && reason !== null && "status" in reason && typeof reason.status === "number") {
            return reason.status === 408 || reason.status === 429 || (reason.status >= 500 && reason.status <= 599)
        }
        return reason instanceof TypeError || (typeof reason === "object" && reason !== null &&
            "retryable" in reason && reason.retryable === true)
    }

    const downloads = new Promises.Limit<unknown>(4)
    /** One permit owns metadata, response consumption and decoding at stock load boundaries. */
    export const withDownload = <T>(consume: () => Promise<T>): Promise<T> =>
        // Limit preserves the callback's exact result; the shared queue erases only its type.
        downloads.add(consume) as Promise<T>

    const abortable = <T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> => {
        if (!signal) {return promise}
        return new Promise((resolve, reject) => {
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
    }

    export class ResponseReadError extends Error {
        constructor(kind: "byte limit" | "encoding") {
            super(kind === "byte limit" ? "Response byte limit exceeded" : "Unsupported response encoding")
        }
    }

    /** Consume once, checking decoded bytes before retaining each chunk. */
    export const readBounded = async (response: Response, maxBytes: number,
                                     signal?: AbortSignal, progress?: Progress.Handler): Promise<ArrayBuffer> => {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {throw new RangeError("Invalid response byte limit")}
        const reader = response.body?.getReader()
        if (!reader) {throw new Error("Missing response body")}
        let complete = false
        let cancelled = false
        const cancel = () => {
            if (cancelled) {return}
            cancelled = true
            void reader.cancel().catch(() => {})
        }
        signal?.addEventListener("abort", cancel, {once: true})
        try {
            signal?.throwIfAborted()
            const encoding = response.headers.get("Content-Encoding")
            // Fetch exposes decoded bytes for these standard transport encodings.
            if (encoding && !["identity", "gzip", "deflate", "br"].includes(encoding.toLowerCase())) {
                throw new ResponseReadError("encoding")
            }
            const declared = Number(response.headers.get("Content-Length") ?? "0")
            if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
                throw new ResponseReadError("byte limit")
            }
            let loaded = 0
            const chunks: Uint8Array[] = []
            for (;;) {
                const {done, value} = await abortable(reader.read(), signal)
                signal?.throwIfAborted()
                if (done) {break}
                if (value.byteLength > maxBytes - loaded) {throw new ResponseReadError("byte limit")}
                loaded += value.byteLength
                chunks.push(value)
                progress?.(declared > 0 ? Math.min(1, loaded / declared) : 0)
            }
            signal?.throwIfAborted()
            progress?.(1)
            signal?.throwIfAborted()
            const bytes = new Uint8Array(loaded)
            let offset = 0
            for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength}
            complete = true
            return bytes.buffer
        } finally {
            signal?.removeEventListener("abort", cancel)
            if (!complete) {cancel()}
            reader.releaseLock()
        }
    }

    const backoff = (signal?: AbortSignal | null): Promise<void> => new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", abort)
            reject(signal?.reason)
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort)
            resolve()
        }, 1000)
        signal?.addEventListener("abort", abort, {once: true})
        if (signal?.aborted) {abort()}
    })

    export const defaultFetch = async (input: RequestInfo | URL, init?: RequestInit,
                                       handler?: Progress.Handler): Promise<Response> => {
        const signal = init?.signal !== undefined ? init.signal
            : typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined
        const wrap = isDefined(handler) ? progress(handler) : identity
        const limit = 30
        let retryCounts = 0
        while (++retryCounts < limit) {
            signal?.throwIfAborted()
            try {
                const response = await abortable(fetch(input, init), signal)
                signal?.throwIfAborted()
                return wrap(response)
            } catch (reason) {
                signal?.throwIfAborted()
                if (Errors.isAbort(reason) || isInstanceOf(reason, Errors.FileNotFound)) {throw reason}
                if (!navigator.onLine) {
                    const retry = await abortable(RuntimeNotifier.approve({
                        headline: "No Internet Connection",
                        message: "You appear to be offline.",
                        approveText: "Retry",
                        cancelText: "Cancel",
                        abortSignal: signal ?? undefined
                    }), signal)
                    signal?.throwIfAborted()
                    if (!retry) {throw reason}
                }
                await backoff(signal)
            }
        }
        return Promise.reject("timeout")
    }

    export const progress = (progress: Progress.Handler) => (response: Response): Response => {
        const body = response.body
        if (isAbsent(body)) {return response}
        const total = parseInt(response.headers.get("Content-Length") ?? "0", 10)
        if (total === 0) {return response}
        let loaded = 0
        const reader = body.getReader()
        let cancelled = false
        const stream = new ReadableStream({
            pull(controller) {
                return reader.read().then(({done, value}) => {
                    if (cancelled) {return}
                    if (done) {
                        controller.close()
                        reader.releaseLock()
                        return
                    }
                    loaded += value.byteLength
                    progress(loaded / total)
                    controller.enqueue(value)
                }).catch(async reason => {
                    if (cancelled) {return}
                    await reader.cancel(reason).catch(() => {})
                    reader.releaseLock()
                    controller.error(reason)
                })
            },
            async cancel(reason) {
                cancelled = true
                return reader.cancel(reason).finally(() => reader.releaseLock())
            }
        }, {highWaterMark: 0})
        return new Response(stream, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        })
    }
}
