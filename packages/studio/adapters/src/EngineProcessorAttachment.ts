import {int, isDefined, Option} from "@opendaw/lib-std"
import {ppqn} from "@opendaw/lib-dsp"

export type ProcessorOptions = NonNullable<unknown>

// This is the type for passing over information to the main audio-worklet
export type EngineProcessorAttachment = {
    syncStreamBuffer: SharedArrayBuffer // SyncStream SharedArrayBuffer
    controlFlagsBuffer: SharedArrayBuffer // Control flags SharedArrayBuffer (e.g., for sleep)
    hrClockBuffer: SharedArrayBuffer // High-res clock SharedArrayBuffer
    project: ArrayBufferLike
    exportConfiguration?: ExportConfiguration
    options?: ProcessorOptions
}

export type ExportStemConfiguration = {
    includeAudioEffects: boolean
    includeSends: boolean
    useInstrumentOutput: boolean
    skipChannelStrip?: boolean
    fileName: string
}

export type ExportRange = "full" | { start: ppqn, end: ppqn }

export type ExportConfiguration = {
    stems?: Record<string, ExportStemConfiguration>
    range?: ExportRange
}

export namespace ExportConfiguration {
    export const countStems = (config: Option<ExportConfiguration>): int =>
        config.match({
            none: () => 1,
            some: cfg => isDefined(cfg.stems) ? Object.keys(cfg.stems).length : 1
        })

    const utf8 = new TextEncoder()
    const boundedName = (name: string, maxBytes: number): string => {
        let result = "", bytes = 0
        for (const character of name) {
            const size = utf8.encode(character).length
            if (bytes + size > maxBytes) {break}
            result += character
            bytes += size
        }
        return result.replace(/[. ]+$/u, "")
    }

    export const sanitizeFileName = (name: string): string => {
        let base = Array.from(name.normalize("NFKC"), character => character.charCodeAt(0) <= 31
            || '<>:"/\\|?*'.includes(character) ? "_" : character).join("").trim().replace(/[. ]+$/u, "")
        if (!/[\p{L}\p{N}]/u.test(base)) {base = "Stem"}
        if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(base)) {base = `_${base}`}
        return boundedName(base, 200)
    }

    export const sanitizeExportNamesInPlace = (configuration: ExportConfiguration): void => {
        if (!isDefined(configuration.stems)) {return}
        const used = new Set<string>()
        const collisionKey = (name: string) => name.normalize("NFKC").toUpperCase().toLowerCase()
        for (const entry of Object.values(configuration.stems)) {
            const base = sanitizeFileName(entry.fileName)
            let name = base, count = 1
            while (used.has(collisionKey(name))) {
                const suffix = ` ${count++}`
                name = boundedName(base, 200 - utf8.encode(suffix).length) + suffix
            }
            used.add(collisionKey(name))
            entry.fileName = name
        }
    }
}
