export type ErrorInfo = {
    name: string
    message?: string
    stack?: string
}

export namespace ErrorInfo {
    // Rejection values are arbitrary user code, including revoked proxies. Never
    // enumerate, serialize or coerce objects while handling the original failure.
    const read = (value: unknown, key: PropertyKey): unknown => {
        try {return value == null ? undefined : Reflect.get(Object(value), key)} catch {return undefined}
    }
    const text = (value: unknown, limit = 2048): string | undefined => {
        switch (typeof value) {
            case "string": return value.slice(0, limit)
            case "number": case "boolean": case "bigint": case "symbol": return String(value).slice(0, limit)
            default: return undefined
        }
    }
    const fromUnknown = (value: unknown, fallbackName: string, fallbackMessage?: string): ErrorInfo => {
        const name = text(read(value, "name"), 128) || fallbackName
        const stack = text(read(value, "stack"), 8192)
        const message = text(read(value, "message")) ?? text(value) ?? fallbackMessage
            ?? (value === null ? "(rejected with null)" : value === undefined ? "(rejected with undefined)"
                : ["code", "reason"].map(key => {
                    const part = text(read(value, key), 512)
                    return part === undefined ? "" : `${key}: ${part}`
                }).filter(Boolean).join(" | ") || "(unavailable rejection details)")
        return {name, message, stack}
    }

    export const extract = (event: Event): ErrorInfo => {
        // Property reads and instanceof itself can throw for hostile event/proxy
        // values. Keep the outer fallback independent of the supplied object.
        try {
            const type = text(read(event, "type"), 128)
            if (type === "unhandledrejection") {
                return fromUnknown(read(event, "reason"), "UnhandledRejection")
            }
            if (event instanceof ErrorEvent) {
                const error = read(event, "error")
                const info = error == null
                    ? {name: "Error", message: text(read(event, "message"))} as ErrorInfo
                    : fromUnknown(error, "Error", text(read(event, "message")))
                const filename = text(read(event, "filename"))
                if (filename) {
                    info.stack = `${info.stack ?? ""}\nat ${filename}:${text(read(event, "lineno")) ?? 0}:${text(read(event, "colno")) ?? 0}`.slice(-8192)
                }
                return info
            }
            if (event instanceof MessageEvent) {return fromUnknown(read(event, "data"), "MessageError")}
            if (type === "securitypolicyviolation") {
                return {name: "SecurityPolicyViolation", message: `${text(read(event, "violatedDirective")) ?? "CSP"} blocked ${text(read(event, "blockedURI")) ?? "unknown"}`.slice(0, 2048)}
            }
            const target = read(event, "target")
            if (target instanceof HTMLMediaElement) {
                const error = read(target, "error")
                if (error != null) {
                    return {name: "MediaError", message: text(read(error, "message")) || `code ${text(read(error, "code")) ?? "unknown"}`}
                }
            }
            if (type === "processorerror") {
                return {name: "ProcessorError", message: "AudioWorklet threw an exception (check console)"}
            }
            const tagName = target instanceof Element ? text(read(target, "tagName"), 128)?.toLowerCase() : undefined
            return {name: "UnknownError", message: tagName ? `${type} on <${tagName}>` : type ?? "(unavailable event details)"}
        } catch {
            return {name: "UnknownError", message: "(unavailable event details)"}
        }
    }
}
