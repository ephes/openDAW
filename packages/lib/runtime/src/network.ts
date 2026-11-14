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

    export const defaultRetry = (reason: unknown, count: int) => {
        return !isInstanceOf(reason, Errors.FileNotFound) || count <= 100
    }

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
