import {Promises} from "./promises"
import {
    Errors,
    identity,
    int,
    isAbsent,
    isDefined,
    isInstanceOf,
    Progress,
    RuntimeNotifier,
    TimeSpan
} from "@opendaw/lib-std"
import {Wait} from "./wait"

export namespace network {
    const limit = new Promises.Limit<Response>(4)

    export const limitFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        limit.add(() => fetch(input, init))

    export const defaultRetry = (reason: unknown, count: int) => {
        return !isInstanceOf(reason, Errors.FileNotFound) || count <= 100
    }

    export const defaultFetch = async (input: RequestInfo | URL, init?: RequestInit,
                                       handler?: Progress.Handler): Promise<Response> => {
        const wrap = isDefined(handler) ? progress(handler) : identity
        const limit = 30
        let retryCounts = 0
        while (++retryCounts < limit) {
            try {
                return wrap(await fetch(input, init))
            } catch (reason) {
                if (isInstanceOf(reason, Errors.FileNotFound)) {throw reason}
                if (navigator.onLine) {
                    await Wait.timeSpan(TimeSpan.seconds(1))
                } else {
                    const retry = await RuntimeNotifier.approve({
                        headline: "No Internet Connection",
                        message: "You appear to be offline.",
                        approveText: "Retry",
                        cancelText: "Cancel"
                    })
                    if (retry) {
                        await Wait.timeSpan(TimeSpan.seconds(1))
                    } else {
                        return Promise.reject(reason)
                    }
                }
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
