import {Errors} from "@opendaw/lib-std"
import {network} from "@opendaw/lib-runtime"
import {OpfsProtocol} from "@opendaw/lib-fusion"

export class CloudError extends Error {
    constructor(message: string, readonly status?: number, readonly retryable = false) {super(message)}
}

export const cloudDownloadLimit = (path: string): number => {
    const clean = path.replace(/^\/+/, "")
    // Aggregate domain catalogs grow with the library; per-item metadata stays small.
    if (clean === "index.json" || clean.endsWith("/index.json")) {return OpfsProtocol.ReadLimits.Project}
    if (clean.endsWith(".json")) {return OpfsProtocol.ReadLimits.Metadata}
    if (clean.startsWith("presets/")) {return OpfsProtocol.ReadLimits.Preset}
    if (clean.startsWith("samples/") || clean.startsWith("soundfonts/") || clean.endsWith("/image.bin")) {
        return OpfsProtocol.ReadLimits.Media
    }
    return OpfsProtocol.ReadLimits.Project
}

export const checkCloudResponse = (response: Response, operation: string): void => {
    if (response.ok) {return}
    void response.body?.cancel().catch(() => {})
    throw new CloudError(`Cloud ${operation} failed (HTTP ${response.status})`, response.status)
}

export const cloudJson = async <T>(response: Response, signal?: AbortSignal): Promise<T> =>
    JSON.parse(new TextDecoder().decode(await network.readBounded(response, OpfsProtocol.ReadLimits.Metadata, signal))) as T

// A stall bound, not a speed requirement: ten minutes plus the payload budget at 128 KiB/s.
export const cloudDeadline = (transferBytes: number): number =>
    600000 + Math.ceil(Math.max(0, transferBytes) / (128 * 1024)) * 1000

export const cloudOperation = async <T>(operation: string, caller: AbortSignal | undefined,
                                        run: (signal: AbortSignal) => Promise<T>,
                                        transferBytes = 0): Promise<T> => {
    const controller = new AbortController()
    const signal = controller.signal
    const forwardAbort = () => controller.abort(new DOMException("Cloud operation aborted", "AbortError"))
    caller?.addEventListener("abort", forwardAbort, {once: true})
    if (caller?.aborted) {forwardAbort()}
    const timer = setTimeout(() => controller.abort(new CloudError(`Cloud ${operation} deadline exceeded`, undefined, true)),
        cloudDeadline(transferBytes))
    let onAbort: () => void = () => {}
    try {
        signal.throwIfAborted()
        const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason)
            signal.addEventListener("abort", onAbort, {once: true})
        })
        // Race observes late SDK settlements even when a transport ignores abort.
        return await Promise.race([run(signal), aborted])
    } catch (error) {
        if (signal.aborted) {
            throw signal.reason
        }
        if (error instanceof Errors.FileNotFound) {throw error}
        if (error instanceof CloudError) {
            throw new CloudError(`Cloud ${operation} failed: ${error.message}`, error.status, error.retryable)
        }
        const status = typeof error === "object" && error !== null && "status" in error &&
            typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
            ? error.status : undefined
        throw new CloudError(`Cloud ${operation} failed${status ? ` (HTTP ${status})` : " (transport or invalid response)"}`, status, error instanceof TypeError)
    } finally {
        caller?.removeEventListener("abort", forwardAbort)
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
    }
}

// Observe late headers and cancel them, while releasing lookup/folder ownership now.
export const cloudFetch = (input: RequestInfo | URL, init: RequestInit): Promise<Response> => {
    const signal = init.signal
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal?.reason)
        signal?.addEventListener("abort", abort, {once: true})
        Promise.resolve().then(() => {
            signal?.throwIfAborted()
            return fetch(input, init)
        }).then(response => {
            signal?.removeEventListener("abort", abort)
            if (signal?.aborted) {void response.body?.cancel().catch(() => {}); reject(signal.reason)}
            else {resolve(response)}
        }, error => {
            signal?.removeEventListener("abort", abort)
            reject(error)
        })
    })
}
