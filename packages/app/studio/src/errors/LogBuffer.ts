export namespace LogBuffer {
    export type Entry = {
        time: number
        level: "debug" | "info" | "warn"
        args: Array<string>
    }

    const logBuffer: Entry[] = []

    if (import.meta.env.PROD) {
        let retainedSize = 2 // JSON array brackets, measured in UTF-16 code units
        const MAX_REPORT_SIZE = 100_000
        const MAX_ENTRY_SIZE = 8000
        const pushLog = (level: Entry["level"], args: unknown[]) => {
            const entry: Entry = {time: Date.now(), level, args: []}
            for (const arg of args.slice(0, 32)) {
                const value = stringifyArg(arg)
                let text = value.length > 4000 ? value.slice(0, 3999) + "…" : value
                entry.args.push(text)
                const excess = JSON.stringify(entry).length - MAX_ENTRY_SIZE
                if (excess > 0) {
                    // One input code unit produces at least one serialized code unit.
                    text = text.slice(0, Math.max(0, text.length - excess))
                    entry.args[entry.args.length - 1] = text
                    if (JSON.stringify(entry).length > MAX_ENTRY_SIZE) {entry.args.pop()}
                    break
                }
            }
            logBuffer.push(entry)
            retainedSize += JSON.stringify(entry).length + 1
            while (retainedSize > MAX_REPORT_SIZE && logBuffer.length > 0) {
                retainedSize -= JSON.stringify(logBuffer.shift()!).length + 1
            }
        }
        const stringifyArg = (value: unknown): string => {
            try {
                // If it's already a primitive
                if (
                    value === null ||
                    typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean" ||
                    typeof value === "bigint" ||
                    typeof value === "symbol" ||
                    typeof value === "undefined"
                ) {
                    return String(value)
                }

                // If it has a custom toString implementation
                const protoToString = Object.prototype.toString
                if (
                    typeof value === "object" &&
                    value &&
                    typeof value.toString === "function" &&
                    value.toString !== protoToString
                ) {
                    const result = value.toString()
                    if (typeof result === "string") return result
                }

                if (typeof value === "object") {
                    const maxLength = 4000
                    let visited = 0
                    const json = JSON.stringify(value, (_key, item) => {
                        if (++visited > 200) {throw new Error("Diagnostic object budget")}
                        return typeof item === "string" ? item.slice(0, 4000) : item
                    })
                    return json.length > maxLength ? json.slice(0, maxLength) + "…" : json
                }

                // Last resort fallback
                return Object.prototype.toString.call(value)
            } catch {
                return "[unserializable]"
            }
        }

        const original = {debug: console.debug, info: console.info, warn: console.warn} as const
        console.debug = (...args) => {
            pushLog("debug", args)
            original.debug.apply(console, args)
        }
        console.info = (...args) => {
            pushLog("info", args)
            original.info.apply(console, args)
        }
        console.warn = (...args) => {
            pushLog("warn", args)
            original.warn.apply(console, args)
        }
    }
    export const get = () => logBuffer
}